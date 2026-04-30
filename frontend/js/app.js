/**
 * 水利数字孪生系统 - 前端主逻辑
 */
const APP_API_BASE = window.WATER_TWIN_API || '';

const viewers = {};
let currentFileId = null;
let currentMode = 'original';
let currentViewMode = 'single';
let hasPrediction = false;
let currentFileHasLabels = false;
let isSyncingControls = false;
let riskRegions = [];
let activeRiskRegionCode = null;
let selectedSemanticIds = new Set();
let selectedBusinessNames = new Set();
let semanticStatsCache = [];
let businessStatsCache = [];
let highlightFilterMode = 'dim';

const businessPalette = {
    '居民地设施': '#e6194b',
    '交通': '#ffe119',
    '水系': '#0000ff',
    '地形': '#911eb4',
    '植被农田': '#3cb44b',
    '其他': '#808080',
};
const businessCategoryMap = new Map([
    [0, '灞呮皯鍦拌鏂?'],
    [1, '灞呮皯鍦拌鏂?'],
    [2, '浜ら€?'],
    [3, '浜ら€?'],
    [4, '鍦板舰'],
    [5, '鍦板舰'],
    [6, '姘寸郴'],
    [7, '妞嶈鍐滅敯'],
    [8, '妞嶈鍐滅敯'],
    [9, '妞嶈鍐滅敯'],
    [10, '妞嶈鍐滅敯'],
    [11, '鍦板舰'],
    [12, '姘寸郴'],
    [13, '姘寸郴'],
    [14, '鍏朵粬'],
]);
const dimColor = [70, 78, 92];
const analysisStatusText = document.getElementById('analysisStatusText');
const downsampleInput = document.getElementById('downsampleInput');
const actionSection = document.getElementById('actionSection');
const sceneSection = document.getElementById('sceneSection');
const statsSection = document.getElementById('statsSection');
const riskSection = document.getElementById('riskSection');
const emptyState = document.getElementById('emptyState');
const legendList = document.getElementById('legendList');
const businessStatsEl = document.getElementById('businessStats');
const alertsList = document.getElementById('alertsList');
const riskRegionList = document.getElementById('riskRegionList');

downsampleInput?.addEventListener('change', () => {
    const value = normalizeDownsampleValue(downsampleInput.value);
    downsampleInput.value = String(value);
    clearCachedViewState();
    window.TaskState?.write?.({ downsample: value });
});

function initScenes() {
    createViewer('single', 'viewportSingle', 'viewportInfoSingle');
    createViewer('compare', 'viewportCompare', 'viewportInfoCompare');
    updateViewportLayout();
    animate();
    window.addEventListener('resize', handleResize);
}

function createViewer(key, containerId, infoId) {
    const container = document.getElementById(containerId);
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    camera.position.set(0, 0, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.addEventListener('change', () => syncViewerControls(key));

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    viewers[key] = {
        key,
        container,
        infoEl: document.getElementById(infoId),
        scene,
        camera,
        renderer,
        controls,
        pointCloud: null,
        rawCenter: [0, 0, 0],
        boundingRadius: 100,
        highlightBox: null,
    };
}

function animate() {
    requestAnimationFrame(animate);

    Object.values(viewers).forEach((viewer) => {
        viewer.controls.update();
        viewer.renderer.render(viewer.scene, viewer.camera);
    });
}

function handleResize() {
    Object.values(viewers).forEach((viewer) => {
        const width = Math.max(viewer.container.clientWidth, 1);
        const height = Math.max(viewer.container.clientHeight, 1);
        viewer.camera.aspect = width / height;
        viewer.camera.updateProjectionMatrix();
        viewer.renderer.setSize(width, height);
    });
}

function syncViewerControls(sourceKey) {
    if (currentViewMode !== 'compare' || isSyncingControls) {
        return;
    }

    const source = viewers[sourceKey];
    const targetKey = sourceKey === 'single' ? 'compare' : 'single';
    const target = viewers[targetKey];
    if (!source || !target) {
        return;
    }

    isSyncingControls = true;
    target.camera.position.copy(source.camera.position);
    target.camera.quaternion.copy(source.camera.quaternion);
    target.controls.target.copy(source.controls.target);
    target.camera.zoom = source.camera.zoom;
    target.camera.updateProjectionMatrix();
    target.controls.update();
    isSyncingControls = false;
}

function updateViewportLayout() {
    const grid = document.getElementById('viewportGrid');
    grid.classList.toggle('single', currentViewMode === 'single');
    grid.classList.toggle('compare', currentViewMode === 'compare');
    handleResize();
}

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showLoading('上传中...');
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${APP_API_BASE}/api/upload`, { method: 'POST', body: formData, credentials: 'include' });
        if (!res.ok) throw new Error((await res.json()).detail || '上传失败');
        const data = await res.json();

        currentFileId = data.file_id;
        currentMode = 'original';
        currentViewMode = 'single';
        hasPrediction = false;
        currentFileHasLabels = Boolean(data.info?.has_labels);
        riskRegions = [];
        activeRiskRegionCode = null;
        window.TaskState?.write?.({
            fileId: data.file_id,
            filename: data.filename,
            fileInfo: data.info,
            hasPrediction: false,
            currentMode: 'original',
            currentViewMode: 'single',
            downsample: getCurrentDownsample(),
            statistics: null,
            alerts: [],
            inspection: null,
            floodState: null,
            embankmentState: null,
            highlightState: null,
        });

        resetHighlightSelection();
        showFileInfo(data);
        resetPredictionPanels();
        updateModeButtons();
        updateViewModeButtons();
        updateViewportLayout();
        updateAnalysisStatus();

        if (actionSection) actionSection.style.display = '';
        if (emptyState) emptyState.style.display = 'none';

        await loadCurrentView();
    } catch (err) {
        alert('上传失败: ' + err.message);
    } finally {
        hideLoading();
        e.target.value = '';
    }
});

function showFileInfo(data) {
    const info = data.info;
    const el = document.getElementById('fileInfo');
    if (!el) {
        return;
    }
    el.style.display = '';
    el.innerHTML = `
        <strong>文件:</strong> ${data.filename}<br>
        <strong>点数:</strong> ${info.num_points.toLocaleString()}<br>
        <strong>维度:</strong> ${info.shape.join(' x ')}<br>
        <strong>含标签:</strong> ${info.has_labels ? '是' : '否'}<br>
        <strong>坐标范围:</strong><br>
        &nbsp; X: ${info.xyz_min[0].toFixed(1)} ~ ${info.xyz_max[0].toFixed(1)}<br>
        &nbsp; Y: ${info.xyz_min[1].toFixed(1)} ~ ${info.xyz_max[1].toFixed(1)}<br>
        &nbsp; Z: ${info.xyz_min[2].toFixed(1)} ~ ${info.xyz_max[2].toFixed(1)}
    `;

    if (sceneSection) sceneSection.style.display = '';
    const sceneEl = document.getElementById('sceneInfo');
    if (!sceneEl) {
        return;
    }
    const dx = info.xyz_max[0] - info.xyz_min[0];
    const dy = info.xyz_max[1] - info.xyz_min[1];
    const dz = info.xyz_max[2] - info.xyz_min[2];
    sceneEl.innerHTML = `
        <strong>场景范围:</strong><br>
        &nbsp; 长: ${dx.toFixed(1)}m | 宽: ${dy.toFixed(1)}m | 高: ${dz.toFixed(1)}m<br>
        <strong>面积约:</strong> ${(dx * dy).toFixed(0)} m&sup2;
    `;
}

function updateAnalysisStatus() {
    if (!analysisStatusText) {
        return;
    }
    if (!currentFileId) {
        analysisStatusText.textContent = '未加载任务';
        return;
    }
    const suffix = hasPrediction ? '已完成分割' : (currentFileHasLabels ? '已加载原始标签' : '待分割');
    analysisStatusText.textContent = `${currentFileId} | ${suffix}`;
}

async function loadCurrentView() {
    if (!currentFileId) {
        return;
    }

    const cachedView = await getCachedViewState();
    if (cachedView) {
        restoreCachedView(cachedView);
        return;
    }

    showLoading(currentViewMode === 'compare' ? '加载对比视图...' : '加载点云...');

    try {
        if (currentViewMode === 'compare') {
            if (!hasPrediction) {
                throw new Error('请先执行语义分割后再查看对比');
            }
            await Promise.all([
                loadPointCloudIntoViewer('single', currentMode, currentMode === 'original' ? 'pred' : 'raw'),
                loadPointCloudIntoViewer('compare', currentMode, 'pred'),
            ]);
            syncViewerControls('single');
        } else {
            const singleSource = currentMode === 'original' ? 'pred' : (hasPrediction ? 'pred' : 'raw');
            await loadPointCloudIntoViewer('single', currentMode, singleSource);
            clearViewer('compare');
            viewers.compare.infoEl.textContent = '对比视图: 左侧原始标签 / 右侧预测结果';
        }
    } catch (err) {
        alert('加载失败: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function loadPointCloudIntoViewer(viewerKey, mode, source = 'pred') {
    const ds = getCurrentDownsample();
    const res = await fetch(
        `${APP_API_BASE}/api/pointcloud/${currentFileId}?mode=${mode}&downsample=${ds}&source=${source}`
    );
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: '点云加载失败' }));
        throw new Error(error.detail || '点云加载失败');
    }

    const data = await res.json();
    renderPointCloud(viewerKey, data.positions, data.colors, data.labels, mode);
    viewers[viewerKey].infoEl.textContent =
        `${data.count.toLocaleString()} 点 | ${viewerLabel(mode, viewerKey, source)}`;
    await cacheViewerData(viewerKey, {
        positions: data.positions,
        colors: data.colors,
        labels: data.labels,
        count: data.count,
        mode,
        source,
    });
}

function viewerLabel(mode, viewerKey, source) {
    if (currentViewMode === 'compare') {
        const title = viewerKey === 'single' ? '左视图' : '右视图';
        const sourceLabel = source === 'raw' ? '原始标签' : '预测结果';
        if (mode === 'original') {
            return `${title}: 原始RGB`;
        }
        if (mode === 'semantic') {
            return `${title}: 语义着色 (${sourceLabel})`;
        }
        return `${title}: 业务着色 (${sourceLabel})`;
    }

    if (mode === 'original') return '模式: 原始';
    if (mode === 'semantic') return source === 'raw' ? '模式: 原始标签语义' : '模式: 预测语义';
    return source === 'raw' ? '模式: 原始标签业务' : '模式: 预测业务';
}

function renderPointCloud(viewerKey, positions, colors, labels = null, mode = currentMode) {
    const viewer = viewers[viewerKey];
    clearViewer(viewerKey);

    const count = positions.length;
    const geometry = new THREE.BufferGeometry();
    const posArr = new Float32Array(count * 3);
    const colArr = new Float32Array(count * 3);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i += 1) {
        cx += positions[i][0];
        cy += positions[i][1];
        cz += positions[i][2];
    }
    cx /= count;
    cy /= count;
    cz /= count;
    viewer.rawCenter = [cx, cy, cz];

    for (let i = 0; i < count; i += 1) {
        posArr[i * 3] = positions[i][0] - cx;
        posArr[i * 3 + 1] = positions[i][2] - cz;
        posArr[i * 3 + 2] = -(positions[i][1] - cy);

        colArr[i * 3] = colors[i][0] / 255;
        colArr[i * 3 + 1] = colors[i][1] / 255;
        colArr[i * 3 + 2] = colors[i][2] / 255;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    const material = new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
    });

    viewer.pointCloud = new THREE.Points(geometry, material);
    viewer.scene.add(viewer.pointCloud);
    viewer.basePositions = new Float32Array(posArr);
    viewer.baseColors = new Float32Array(colArr);
    viewer.labels = Array.isArray(labels) ? labels : null;
    viewer.renderMode = mode;
    viewer.fullPointCount = count;

    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius || 100;
    viewer.boundingRadius = radius;
    viewer.camera.position.set(radius * 1.2, radius * 0.8, radius * 1.2);
    viewer.controls.target.set(0, 0, 0);
    viewer.controls.update();
    applyHighlightToViewer(viewerKey);
}

function clearViewer(viewerKey) {
    const viewer = viewers[viewerKey];
    if (!viewer) {
        return;
    }

    clearRiskHighlight(viewerKey);
    if (!viewer.pointCloud) {
        return;
    }

    viewer.scene.remove(viewer.pointCloud);
    viewer.pointCloud.geometry.dispose();
    viewer.pointCloud.material.dispose();
    viewer.pointCloud = null;
    viewer.basePositions = null;
    viewer.baseColors = null;
    viewer.labels = null;
    viewer.renderMode = null;
    viewer.fullPointCount = 0;
}

function resetHighlightSelection() {
    selectedSemanticIds = new Set();
    selectedBusinessNames = new Set();
    semanticStatsCache = [];
    businessStatsCache = [];
    highlightFilterMode = 'dim';
}

function applyHighlightToAllViewers() {
    applyHighlightToViewer('single');
    applyHighlightToViewer('compare');
}

function applyHighlightToViewer(viewerKey) {
    const viewer = viewers[viewerKey];
    if (!viewer?.pointCloud || !viewer.baseColors || !viewer.basePositions) {
        return;
    }

    const baseColors = viewer.baseColors;
    const basePositions = viewer.basePositions;
    const labels = Array.isArray(viewer.labels) ? viewer.labels : null;
    const shouldFilter = labels && (selectedSemanticIds.size > 0 || selectedBusinessNames.size > 0);

    const highlightedIndices = [];
    const dimmedColors = new Float32Array(baseColors.length);

    for (let i = 0; i < viewer.fullPointCount; i += 1) {
        const offset = i * 3;
        let highlight = true;
        if (shouldFilter) {
            const label = Number(labels[i]);
            const semanticMatched = selectedSemanticIds.size === 0 || selectedSemanticIds.has(label);
            const businessName = findBusinessNameByClassId(label);
            const businessMatched = selectedBusinessNames.size === 0 || (businessName ? selectedBusinessNames.has(businessName) : false);
            highlight = semanticMatched && businessMatched;
        }

        if (highlight) {
            highlightedIndices.push(i);
            dimmedColors[offset] = baseColors[offset];
            dimmedColors[offset + 1] = baseColors[offset + 1];
            dimmedColors[offset + 2] = baseColors[offset + 2];
        } else {
            dimmedColors[offset] = dimColor[0] / 255;
            dimmedColors[offset + 1] = dimColor[1] / 255;
            dimmedColors[offset + 2] = dimColor[2] / 255;
        }
    }

    if (!shouldFilter || highlightFilterMode === 'dim') {
        setViewerPointCloudGeometry(viewer, basePositions, dimmedColors);
        viewer.pointCloud.material.opacity = 1;
        viewer.pointCloud.material.needsUpdate = true;
        return;
    }

    const subsetPositions = new Float32Array(highlightedIndices.length * 3);
    const subsetColors = new Float32Array(highlightedIndices.length * 3);
    for (let i = 0; i < highlightedIndices.length; i += 1) {
        const sourceIndex = highlightedIndices[i] * 3;
        const targetIndex = i * 3;
        subsetPositions[targetIndex] = basePositions[sourceIndex];
        subsetPositions[targetIndex + 1] = basePositions[sourceIndex + 1];
        subsetPositions[targetIndex + 2] = basePositions[sourceIndex + 2];
        subsetColors[targetIndex] = baseColors[sourceIndex];
        subsetColors[targetIndex + 1] = baseColors[sourceIndex + 1];
        subsetColors[targetIndex + 2] = baseColors[sourceIndex + 2];
    }

    setViewerPointCloudGeometry(viewer, subsetPositions, subsetColors);
    viewer.pointCloud.material.opacity = 1;
    viewer.pointCloud.material.needsUpdate = true;
}

function setViewerPointCloudGeometry(viewer, positions, colors) {
    const geometry = viewer.pointCloud.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
}

function findBusinessNameByClassId(classId) {
    const source = businessStatsCache.length
        ? businessStatsCache
        : (window.TaskState?.read?.()?.statistics?.business_stats || []);
    const matched = source.find((entry) => Array.isArray(entry.class_ids) && entry.class_ids.includes(classId));
    return matched?.name || null;
}

function toggleSemanticHighlight(classId) {
    const next = new Set(selectedSemanticIds);
    if (next.has(classId)) {
        next.delete(classId);
    } else {
        next.add(classId);
    }
    selectedSemanticIds = next;
    persistHighlightState();
    updateLegend(semanticStatsCache);
    applyHighlightToAllViewers();
}

function toggleBusinessHighlight(name) {
    const next = new Set(selectedBusinessNames);
    if (next.has(name)) {
        next.delete(name);
    } else {
        next.add(name);
    }
    selectedBusinessNames = next;
    persistHighlightState();
    updateBusinessStats(businessStatsCache);
    applyHighlightToAllViewers();
}

function persistHighlightState() {
    window.TaskState?.write?.({
        highlightState: {
            semanticIds: Array.from(selectedSemanticIds),
            businessNames: Array.from(selectedBusinessNames),
            mode: highlightFilterMode,
        },
    });
}

function restoreHighlightState(task) {
    const highlightState = task?.highlightState || {};
    selectedSemanticIds = new Set(Array.isArray(highlightState.semanticIds) ? highlightState.semanticIds : []);
    selectedBusinessNames = new Set(Array.isArray(highlightState.businessNames) ? highlightState.businessNames : []);
    highlightFilterMode = highlightState.mode === 'hide' ? 'hide' : 'dim';
}

function setHighlightFilterMode(mode) {
    highlightFilterMode = mode === 'hide' ? 'hide' : 'dim';
    persistHighlightState();
    updateHighlightModeButtons();
    applyHighlightToAllViewers();
}

function updateHighlightModeButtons() {
    document.querySelectorAll('[data-highlight-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.highlightMode === highlightFilterMode);
    });
}

function switchMode(mode) {
    if (mode !== 'original' && !hasPrediction && !currentFileHasLabels) {
        alert('当前文件没有原始标签，请先执行语义分割');
        return;
    }

    currentMode = mode;
    clearCachedViewState();
    window.TaskState?.write?.({ currentMode });
    updateModeButtons();
    loadCurrentView();
}

function switchViewMode(viewMode) {
    if (viewMode === 'compare' && !hasPrediction) {
        alert('请先执行语义分割，再查看原始点云与分割结果对比');
        return;
    }

    currentViewMode = viewMode;
    clearCachedViewState();
    window.TaskState?.write?.({ currentViewMode });
    updateViewModeButtons();
    updateModeButtons();
    updateViewportLayout();
    loadCurrentView();
}

function updateModeButtons() {
    document.querySelectorAll('#modeGroup .btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
        btn.disabled = btn.dataset.mode !== 'original' && !hasPrediction && !currentFileHasLabels;
    });
}

function updateViewModeButtons() {
    document.querySelectorAll('#viewModeGroup .btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.viewMode === currentViewMode);
    });
}

async function runPrediction() {
    if (!currentFileId) return;

    const btn = document.getElementById('btnPredict');
    btn.disabled = true;
    btn.textContent = '推理中...';
    showLoading('语义分割推理中，请稍候...');

    try {
        const res = await fetch(`${APP_API_BASE}/api/predict/${currentFileId}`, { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error((await res.json()).detail || '推理失败');
        const data = await res.json();

        hasPrediction = true;
        resetHighlightSelection();
        updateLegend(data.statistics.class_stats);
        updateBusinessStats(data.statistics.business_stats);
        updateAlerts(data.alerts);
        window.TaskState?.write?.({
            fileId: currentFileId,
            hasPrediction: true,
            currentMode: 'semantic',
            currentViewMode: 'single',
            statistics: data.statistics,
            alerts: data.alerts,
            inspection: data.inspection || null,
            floodState: null,
            embankmentState: null,
            highlightState: null,
        });
        clearCachedViewState();

        if (statsSection) statsSection.style.display = '';
        if (riskSection) riskSection.style.display = '';

        currentMode = 'semantic';
        currentViewMode = 'single';
        updateModeButtons();
        updateViewModeButtons();
        updateHighlightModeButtons();
        updateViewportLayout();
        updateAnalysisStatus();
        await loadCurrentView();
        await fetchRiskRegions();

        alert(`分割完成，耗时 ${data.elapsed_seconds} 秒`);
    } catch (err) {
        alert('推理失败: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '执行语义分割';
        hideLoading();
    }
}

function updateLegend(classStats) {
    const el = legendList;
    if (!el) return;
    semanticStatsCache = Array.isArray(classStats)
        ? classStats.filter((item) => Number(item.count || 0) > 0 && Number(item.ratio || 0) > 0)
        : [];
    el.innerHTML = semanticStatsCache.map((c) => `
        <li class="legend-item ${selectedSemanticIds.has(c.id) ? 'selected' : ''}" onclick="toggleSemanticHighlight(${c.id})">
            <span class="legend-check">${selectedSemanticIds.size === 0 || selectedSemanticIds.has(c.id) ? '&#10003;' : ''}</span>
            <span class="legend-color" style="background:${c.color}"></span>
            <span class="legend-name">${c.name_cn} (${c.name})</span>
            <span class="legend-count">${c.ratio}%</span>
        </li>
    `).join('');
}

function updateBusinessStats(bizStats) {
    const el = businessStatsEl;
    if (!el) return;
    businessStatsCache = Array.isArray(bizStats)
        ? bizStats.filter((item) => Number(item.count || 0) > 0 && Number(item.ratio || 0) > 0)
        : [];
    el.innerHTML = businessStatsCache.map((b) => `
        <div class="stat-bar-wrap ${selectedBusinessNames.has(b.name) ? 'selected' : ''}" data-business-name="${escapeHtml(b.name)}">
            <div class="stat-bar-label">
                <span class="stat-bar-title"><span class="legend-check">${selectedBusinessNames.size === 0 || selectedBusinessNames.has(b.name) ? '&#10003;' : ''}</span>${b.name}</span>
                <span>${b.ratio}% (${b.count.toLocaleString()})</span>
            </div>
            <div class="stat-bar">
                <div class="stat-bar-fill" style="width:${b.ratio}%;background:${businessPalette[b.name] || '#888'}"></div>
            </div>
        </div>
    `).join('');

    el.querySelectorAll('.stat-bar-wrap').forEach((node) => {
        node.addEventListener('click', () => {
            const name = node.dataset.businessName;
            if (name) {
                toggleBusinessHighlight(name);
            }
        });
    });
}

function updateAlerts(alerts) {
    const el = alertsList;
    if (!el) return;
    if (!alerts.length) {
        el.innerHTML = '<div style="font-size:12px;color:var(--text-light);">暂无告警</div>';
        return;
    }

    el.innerHTML = alerts.map((a) => `
        <div class="alert-item alert-${a.level}">
            <div class="alert-title">
                ${a.class_name_cn}
                <span class="alert-badge ${a.level}">${a.level === 'high' ? '高' : a.level === 'medium' ? '中' : '低'}</span>
            </div>
            <div>${a.message}</div>
            <div style="margin-top:4px;color:var(--text-light);">点数: ${a.point_count.toLocaleString()} (${a.ratio}%)</div>
        </div>
    `).join('');
}

function resetPredictionPanels() {
    if (statsSection) statsSection.style.display = 'none';
    if (riskSection) riskSection.style.display = 'none';
    if (legendList) {
        legendList.innerHTML = '<li style="font-size:12px;color:var(--text-light);">上传并分割后显示</li>';
    }
    if (businessStatsEl) businessStatsEl.innerHTML = '';
    if (alertsList) alertsList.innerHTML = '';
    riskRegions = [];
    activeRiskRegionCode = null;
    renderRiskRegions([]);
    clearCachedViewState();
    updateAnalysisStatus();
}

function getCurrentDownsample() {
    return normalizeDownsampleValue(downsampleInput?.value);
}

function normalizeDownsampleValue(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getViewerCacheKey() {
    return currentFileId ? `viewer-cache:${currentFileId}` : null;
}

async function cacheViewerData(viewerKey, payload) {
    const cacheKey = getViewerCacheKey();
    if (!cacheKey) {
        return;
    }

    const currentCache = await window.TaskState?.getViewerCache?.(cacheKey) || {};
    const nextCachedView = {
        ...currentCache,
        fileId: currentFileId,
        currentMode,
        currentViewMode,
        downsample: getCurrentDownsample(),
        [viewerKey]: payload,
    };
    await window.TaskState?.setViewerCache?.(cacheKey, nextCachedView);
}

function clearCachedViewState() {
    const cacheKey = getViewerCacheKey();
    if (!cacheKey) {
        return;
    }
    window.TaskState?.clearViewerCache?.(cacheKey);
}

async function getCachedViewState() {
    const cacheKey = getViewerCacheKey();
    if (!cacheKey) {
        return null;
    }

    const cachedView = await window.TaskState?.getViewerCache?.(cacheKey);
    if (!cachedView || cachedView.fileId !== currentFileId) {
        return null;
    }
    if (cachedView.currentMode !== currentMode || cachedView.currentViewMode !== currentViewMode) {
        return null;
    }
    if (normalizeDownsampleValue(cachedView.downsample) !== getCurrentDownsample()) {
        return null;
    }
    if (!cachedView.single) {
        return null;
    }
    if (currentViewMode === 'compare' && !cachedView.compare) {
        return null;
    }
    return cachedView;
}

function restoreCachedView(cachedView) {
    renderPointCloud('single', cachedView.single.positions, cachedView.single.colors, cachedView.single.labels, cachedView.single.mode);
    viewers.single.infoEl.textContent =
        `${cachedView.single.count.toLocaleString()} ??| ${viewerLabel(cachedView.single.mode, 'single', cachedView.single.source)}`;

    if (currentViewMode === 'compare' && cachedView.compare) {
        renderPointCloud('compare', cachedView.compare.positions, cachedView.compare.colors, cachedView.compare.labels, cachedView.compare.mode);
        viewers.compare.infoEl.textContent =
            `${cachedView.compare.count.toLocaleString()} ??| ${viewerLabel(cachedView.compare.mode, 'compare', cachedView.compare.source)}`;
        syncViewerControls('single');
    } else {
        clearViewer('compare');
        viewers.compare.infoEl.textContent = '对比视图：左侧原始标签 / 右侧预测结果';
    }
    applyHighlightToAllViewers();
}

async function restoreTaskState() {
    const task = window.TaskState?.read?.();
    if (!task || !task.fileId) {
        return;
    }

    restoreHighlightState(task);
    currentFileId = task.fileId;
    currentFileHasLabels = Boolean(task.fileInfo?.has_labels);
    hasPrediction = Boolean(task.hasPrediction);
    currentMode = hasPrediction ? (task.currentMode || 'semantic') : 'original';
    currentViewMode = hasPrediction ? (task.currentViewMode || 'single') : 'single';
    if (downsampleInput) {
        downsampleInput.value = String(normalizeDownsampleValue(task.downsample ?? downsampleInput.value));
    }

    if (task.filename && task.fileInfo) {
        showFileInfo({
            file_id: task.fileId,
            filename: task.filename,
            info: task.fileInfo,
        });
    }

    if (actionSection) actionSection.style.display = '';
    if (emptyState) emptyState.style.display = 'none';
    if (statsSection) statsSection.style.display = hasPrediction ? '' : 'none';
    if (riskSection) riskSection.style.display = hasPrediction ? '' : 'none';

    if (task.statistics) {
        updateLegend(task.statistics.class_stats || []);
        updateBusinessStats(task.statistics.business_stats || []);
    }
    if (task.alerts) {
        updateAlerts(task.alerts);
    }

    updateModeButtons();
    updateViewModeButtons();
    updateHighlightModeButtons();
    updateViewportLayout();
    updateAnalysisStatus();

    if (hasPrediction && (!task.statistics || !task.alerts || !task.inspection)) {
        try {
            const res = await fetch(`${APP_API_BASE}/api/statistics/${currentFileId}`);
            if (res.ok) {
                const data = await res.json();
                updateLegend(data.statistics.class_stats);
                updateBusinessStats(data.statistics.business_stats);
                updateAlerts(data.alerts);
                window.TaskState?.write?.({
                    statistics: data.statistics,
                    alerts: data.alerts,
                    inspection: data.inspection || null,
                });
            }
        } catch (err) {
            console.warn('恢复统计结果失败', err);
        }
    }

    try {
        await loadCurrentView();
        if (hasPrediction) {
            await fetchRiskRegions();
        }
    } catch (err) {
        console.warn('恢复点云视图失败', err);
    }
}

async function fetchRiskRegions() {
    if (!currentFileId || !hasPrediction) {
        riskRegions = [];
        activeRiskRegionCode = null;
        renderRiskRegions([]);
        return [];
    }

    try {
        const res = await fetch(`${APP_API_BASE}/api/risk-regions/${currentFileId}`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error('Failed to load risk regions');
        }
        const data = await res.json();
        riskRegions = Array.isArray(data.regions) ? data.regions : [];
        if (!riskRegions.some((item) => item.code === activeRiskRegionCode)) {
            activeRiskRegionCode = riskRegions[0]?.code || null;
        }
        renderRiskRegions(riskRegions);
        return riskRegions;
    } catch (err) {
        console.warn('Failed to fetch risk regions.', err);
        riskRegions = [];
        activeRiskRegionCode = null;
        renderRiskRegions([]);
        return [];
    }
}

function renderRiskRegions(regions) {
    if (!riskRegionList) {
        return;
    }

    if (!regions.length) {
        riskRegionList.innerHTML = '<div class="empty-copy">暂无可定位的风险区域。</div>';
        return;
    }

    riskRegionList.innerHTML = regions.map((region, index) => `
        <div class="risk-region-item ${region.code === activeRiskRegionCode ? 'active' : ''}">
            <div class="risk-region-head">
                <div class="risk-region-title">${region.title}</div>
                <span class="risk-chip ${region.level}">${riskLevelLabel(region.level)}</span>
            </div>
            <div class="risk-region-meta">
                <span>点数 ${Number(region.point_count || 0).toLocaleString()}</span>
                <span>综合 ${Math.round(Number(region.combined_score ?? region.score ?? 0))}</span>
                <span>空间 ${Math.round(Number(region.spatial_score ?? 0))}</span>
                <span>密度 ${Number(region.density_2d ?? 0).toFixed(1)}</span>
                <span>${(region.class_names_cn || []).join(' / ')}</span>
            </div>
            <div class="risk-region-reason">${region.reason || '基于标签占比和巡检规则生成的重点关注区域。'}</div>
            <button class="btn btn-outline btn-sm" onclick="focusRiskRegion(${index})">定位此区域</button>
        </div>
    `).join('');
}

function riskLevelLabel(level) {
    if (level === 'high') return '高风险';
    if (level === 'medium') return '中风险';
    return '低风险';
}

function focusTopRiskRegion() {
    if (!riskRegions.length) {
        alert('当前没有可定位的风险区域');
        return;
    }
    focusRiskRegion(0);
}

function focusRiskRegion(index) {
    const region = riskRegions[index];
    if (!region) {
        return;
    }

    activeRiskRegionCode = region.code;
    renderRiskRegions(riskRegions);
    focusRegionHighlightOnly('single', region);
    if (currentViewMode === 'compare') {
        focusRegionHighlightOnly('compare', region);
        syncViewerControls('single');
    }
}

function focusRegionInViewer(viewerKey, region) {
    const viewer = viewers[viewerKey];
    if (!viewer?.pointCloud) {
        return;
    }

    const center = transformRawPointToViewer(region.center, viewer.rawCenter);
    const min = transformRawPointToViewer(region.bounds_min, viewer.rawCenter);
    const max = transformRawPointToViewer(region.bounds_max, viewer.rawCenter);
    const size = new THREE.Vector3(
        Math.max(Math.abs(max.x - min.x), 6),
        Math.max(Math.abs(max.y - min.y), 6),
        Math.max(Math.abs(max.z - min.z), 6),
    );

    const distance = Math.max(size.length() * 1.7, viewer.boundingRadius * 0.28, 36);
    clearRiskHighlight(viewerKey);
    const color = region.level === 'high' ? 0xd84a3a : region.level === 'medium' ? 0xd99021 : 0x25895d;

    const box = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 1,
        }),
    );
    box.position.copy(center);
    viewer.scene.add(box);
    viewer.highlightBox = box;

    const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(size.length() * 0.08, 2.4), 24, 24),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.92,
        }),
    );
    pulse.position.copy(center);
    viewer.scene.add(pulse);
    viewer.highlightPulse = pulse;

    const label = buildRiskLabelSprite(`${region.title} | 综合 ${Math.round(Number(region.combined_score || region.score || 0))}`, color);
    label.position.set(center.x, center.y + size.y * 0.65 + 6, center.z);
    viewer.scene.add(label);
    viewer.highlightLabel = label;

    viewer.controls.target.copy(center);
    viewer.camera.position.set(center.x + distance, center.y + distance * 0.55, center.z + distance);
    viewer.controls.update();
}

function focusRegionTopDown(viewerKey, region) {
    const viewer = viewers[viewerKey];
    if (!viewer?.pointCloud) {
        return;
    }

    const previousTarget = viewer.controls.target.clone();
    const previousUp = viewer.camera.up.clone();
    const center = transformRawPointToViewer(region.center, viewer.rawCenter);
    const min = transformRawPointToViewer(region.bounds_min, viewer.rawCenter);
    const max = transformRawPointToViewer(region.bounds_max, viewer.rawCenter);
    const width = Math.max(Math.abs(max.x - min.x), 8);
    const depth = Math.max(Math.abs(max.z - min.z), 8);
    const height = Math.max(Math.abs(max.y - min.y), 8);
    const footprint = Math.max(width, depth);
    const distance = Math.max(footprint * 1.45, height * 1.2, 26);

    clearRiskHighlight(viewerKey);
    const color = region.level === 'high' ? 0xd84a3a : region.level === 'medium' ? 0xd99021 : 0x25895d;
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 1,
        }),
    );
    box.position.copy(center);
    viewer.scene.add(box);
    viewer.highlightBox = box;

    const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(Math.max(width, depth, height) * 0.08, 2.4), 24, 24),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.92,
        }),
    );
    pulse.position.copy(center);
    viewer.scene.add(pulse);
    viewer.highlightPulse = pulse;

    const label = buildRiskLabelSprite(`${region.title} | 综合 ${Math.round(Number(region.combined_score || region.score || 0))}`, color);
    label.position.set(center.x, center.y + height * 0.65 + 6, center.z);
    viewer.scene.add(label);
    viewer.highlightLabel = label;

    viewer.camera.position.set(center.x, center.y + distance, center.z);
    viewer.controls.target.copy(previousTarget);
    viewer.camera.up.copy(previousUp);
    const direction = new THREE.Vector3().subVectors(previousTarget, center);
    if (direction.lengthSq() < 1e-6) {
        direction.set(0, -1, 0);
    } else {
        direction.normalize();
    }
    viewer.camera.lookAt(center.clone().add(direction.multiplyScalar(distance * 0.35)));
    viewer.controls.update();
}

function focusRegionHighlightOnly(viewerKey, region) {
    const viewer = viewers[viewerKey];
    if (!viewer?.pointCloud) {
        return;
    }

    const center = transformRawPointToViewer(region.center, viewer.rawCenter);
    const min = transformRawPointToViewer(region.bounds_min, viewer.rawCenter);
    const max = transformRawPointToViewer(region.bounds_max, viewer.rawCenter);
    const size = new THREE.Vector3(
        Math.max(Math.abs(max.x - min.x), 12),
        Math.max(Math.abs(max.y - min.y), 10),
        Math.max(Math.abs(max.z - min.z), 12),
    );

    clearRiskHighlight(viewerKey);
    const color = region.level === 'high' ? 0xd84a3a : region.level === 'medium' ? 0xd99021 : 0x25895d;

    const fill = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
            depthTest: false,
        }),
    );
    fill.position.copy(center);
    viewer.scene.add(fill);
    viewer.highlightFill = fill;

    const box = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 1,
        }),
    );
    box.position.copy(center);
    box.scale.set(1.18, 1.18, 1.18);
    viewer.scene.add(box);
    viewer.highlightBox = box;

    const beaconHeight = Math.max(size.y * 2.8, 30);
    const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, beaconHeight, 14),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
        }),
    );
    beacon.position.set(center.x, center.y + beaconHeight * 0.5, center.z);
    viewer.scene.add(beacon);
    viewer.highlightBeacon = beacon;

    const label = buildRiskLabelSprite(`${region.title} | 综合 ${Math.round(Number(region.combined_score || region.score || 0))}`, color);
    label.position.set(center.x, center.y + beaconHeight + 7, center.z);
    viewer.scene.add(label);
    viewer.highlightLabel = label;
}

function clearRiskHighlight(viewerKey) {
    const viewer = viewers[viewerKey];
    if (!viewer) {
        return;
    }

    if (viewer.highlightBox) {
        viewer.scene.remove(viewer.highlightBox);
        viewer.highlightBox.geometry.dispose();
        viewer.highlightBox.material.dispose();
        viewer.highlightBox = null;
    }
    if (viewer.highlightPulse) {
        viewer.scene.remove(viewer.highlightPulse);
        viewer.highlightPulse.geometry.dispose();
        viewer.highlightPulse.material.dispose();
        viewer.highlightPulse = null;
    }
    if (viewer.highlightFill) {
        viewer.scene.remove(viewer.highlightFill);
        viewer.highlightFill.geometry.dispose();
        viewer.highlightFill.material.dispose();
        viewer.highlightFill = null;
    }
    if (viewer.highlightBeacon) {
        viewer.scene.remove(viewer.highlightBeacon);
        viewer.highlightBeacon.geometry.dispose();
        viewer.highlightBeacon.material.dispose();
        viewer.highlightBeacon = null;
    }
    if (viewer.highlightLabel) {
        viewer.scene.remove(viewer.highlightLabel);
        viewer.highlightLabel.material.map?.dispose?.();
        viewer.highlightLabel.material.dispose();
        viewer.highlightLabel = null;
    }
}

function transformRawPointToViewer(point, rawCenter) {
    return new THREE.Vector3(
        point[0] - rawCenter[0],
        point[2] - rawCenter[2],
        -(point[1] - rawCenter[1]),
    );
}

function buildRiskLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(11,31,42,0.88)';
    roundRect(ctx, 8, 12, 504, 92, 22);
    ctx.fill();

    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 6;
    roundRect(ctx, 8, 12, 504, 92, 22);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px Microsoft YaHei';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 28, 58);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(22, 5.2, 1);
    return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function exportViewportScreenshot() {
    const viewerKey = currentViewMode === 'compare' ? 'compare' : 'single';
    const viewer = viewers[viewerKey];
    if (!viewer?.renderer) {
        alert('当前没有可导出的可视化画面');
        return;
    }

    try {
        viewer.renderer.render(viewer.scene, viewer.camera);
        const dataUrl = viewer.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        const suffix = activeRiskRegionCode ? `_${activeRiskRegionCode}` : '';
        link.href = dataUrl;
        link.download = `${currentFileId || 'pointcloud'}${suffix}_screenshot.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.warn('Failed to export screenshot.', err);
        alert('截图导出失败');
    }
}

async function generateHazardAtlas() {
    if (!riskRegions.length) {
        alert('当前没有可导出的风险区域图册');
        return;
    }

    const previousActive = activeRiskRegionCode;
    const viewerKey = currentViewMode === 'compare' ? 'compare' : 'single';
    const atlasItems = [];

    showLoading('正在生成隐患图册...');
    try {
        for (let index = 0; index < riskRegions.length; index += 1) {
            const region = riskRegions[index];
            activeRiskRegionCode = region.code;
            renderRiskRegions(riskRegions);
            focusRegionAtlasView('single', region);
            if (currentViewMode === 'compare') {
                focusRegionAtlasView('compare', region);
            }
            await waitForNextFrame();

            const viewer = viewers[viewerKey];
            viewer.renderer.render(viewer.scene, viewer.camera);
            atlasItems.push({
                index: index + 1,
                title: region.title,
                level: riskLevelLabel(region.level),
                score: Math.round(Number(region.combined_score ?? region.score ?? 0)),
                pointCount: Number(region.point_count || 0).toLocaleString(),
                reason: region.reason || '基于标签占比和巡检规则生成的重点关注区域。',
                classes: (region.class_names_cn || []).join(' / '),
                image: viewer.renderer.domElement.toDataURL('image/png'),
            });
        }

        const html = buildHazardAtlasHtml(atlasItems);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${currentFileId || 'pointcloud'}_hazard_atlas.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    } catch (err) {
        console.warn('Failed to generate hazard atlas.', err);
        alert('隐患图册导出失败');
    } finally {
        if (previousActive) {
            const previousIndex = riskRegions.findIndex((item) => item.code === previousActive);
            if (previousIndex >= 0) {
                focusRiskRegion(previousIndex);
            }
        }
        hideLoading();
    }
}

function focusRegionAtlasView(viewerKey, region) {
    const viewer = viewers[viewerKey];
    if (!viewer?.pointCloud) {
        return;
    }

    focusRegionHighlightOnly(viewerKey, region);

    const topDistance = Math.max(viewer.boundingRadius * 2.35, 160);
    viewer.camera.position.set(0, topDistance, 0);
    viewer.controls.target.set(0, 0, 0);
    viewer.camera.up.set(0, 0, -1);
    viewer.camera.lookAt(0, 0, 0);
    viewer.controls.update();
}

function buildHazardAtlasHtml(items) {
    const sections = items.map((item) => `
        <section class="atlas-card">
            <div class="atlas-head">
                <div>
                    <div class="atlas-kicker">隐患区域 ${item.index}</div>
                    <h2>${escapeHtml(item.title)}</h2>
                </div>
                <div class="atlas-badge atlas-badge-${item.level}">${escapeHtml(item.level)}</div>
            </div>
            <div class="atlas-meta">
                <span>风险评分 ${escapeHtml(String(item.score))}</span>
                <span>点数 ${escapeHtml(item.pointCount)}</span>
                <span>${escapeHtml(item.classes || '未分类')}</span>
            </div>
            <img class="atlas-image" src="${item.image}" alt="${escapeHtml(item.title)}">
            <p class="atlas-reason">${escapeHtml(item.reason)}</p>
        </section>
    `).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>隐患图册</title>
    <style>
        body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; margin: 0; padding: 32px; background: #eef5f3; color: #13202a; }
        .atlas-shell { max-width: 1200px; margin: 0 auto; display: grid; gap: 20px; }
        .atlas-cover { padding: 28px; border-radius: 28px; color: #fff; background: linear-gradient(135deg, #0b1f2a, #176c8f); }
        .atlas-cover h1 { margin: 10px 0 12px; font-size: 36px; }
        .atlas-cover p { margin: 0; line-height: 1.8; color: rgba(255,255,255,0.8); }
        .atlas-card { padding: 24px; border-radius: 24px; background: #fff; box-shadow: 0 16px 36px rgba(18,45,56,0.1); }
        .atlas-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
        .atlas-kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #176c8f; }
        .atlas-head h2 { margin: 6px 0 0; font-size: 28px; }
        .atlas-badge { padding: 8px 12px; border-radius: 999px; font-weight: 700; }
        .atlas-badge-高风险 { background: rgba(216,74,58,0.14); color: #d84a3a; }
        .atlas-badge-中风险 { background: rgba(217,144,33,0.14); color: #d99021; }
        .atlas-badge-低风险 { background: rgba(37,137,93,0.14); color: #25895d; }
        .atlas-meta { display: flex; flex-wrap: wrap; gap: 12px; margin: 14px 0 18px; color: #657684; font-size: 14px; }
        .atlas-image { width: 100%; border-radius: 18px; background: #1a1a2e; display: block; }
        .atlas-reason { margin: 16px 0 0; line-height: 1.8; color: #415261; }
    </style>
</head>
<body>
    <div class="atlas-shell">
        <section class="atlas-cover">
            <div>Water Twin System</div>
            <h1>自动生成隐患图册</h1>
            <p>文件 ID：${escapeHtml(currentFileId || '-')}，共导出 ${items.length} 个风险区域截图与说明，可直接用于答辩展示、巡检汇报和后续人工复核。</p>
        </section>
        ${sections}
    </div>
</body>
</html>`;
}

function waitForNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;',
    }[char]));
}

function showLoading(text) {
    const loadingText = document.getElementById('loadingText');
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingText) {
        loadingText.textContent = text || '加载中...';
    }
    loadingOverlay?.classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingOverlay')?.classList.remove('show');
}

initScenes();
updateAnalysisStatus();
restoreTaskState();
