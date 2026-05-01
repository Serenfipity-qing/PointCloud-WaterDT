const AI_API_BASE = window.WATER_TWIN_API || '';
const ASSISTANT_CACHE_KEY = 'waterTwinAssistantCache';
const ASSISTANT_SESSIONS_KEY = 'waterTwinAssistantSessions';
const ASSISTANT_CURRENT_SESSION_KEY = 'waterTwinAssistantCurrentSession';
const ASSISTANT_HISTORY_COLLAPSED_KEY = 'waterTwinAssistantHistoryCollapsed';
const MAX_CACHE_ENTRIES = 24;
const MAX_SESSION_COUNT = 20;
const MAX_MESSAGES_PER_SESSION = 50;

const assistantTask = window.TaskState?.read?.();
const assistantTaskCard = document.getElementById('assistantTaskCard');
const assistantChat = document.getElementById('assistantChat');
const assistantShell = document.querySelector('.assistant-shell');
const assistantSessionList = document.getElementById('assistantSessionList');
const assistantHistoryPanel = document.getElementById('assistantHistoryPanel');
const assistantPreset = document.getElementById('assistantPreset');
const assistantQuestionInput = document.getElementById('assistantQuestionInput');
const btnAskAssistant = document.getElementById('btnAskAssistant');
const btnClearAssistantCache = document.getElementById('btnClearAssistantCache');
const btnNewAssistantChat = document.getElementById('btnNewAssistantChat');
const btnToggleAssistantHistory = document.getElementById('btnToggleAssistantHistory');
const assistantEmptyState = document.getElementById('assistantEmptyState');
const assistantSessionTip = document.getElementById('assistantSessionTip');
const assistantWorkbenchTitle = document.getElementById('assistantWorkbenchTitle');

const QUESTION_MAP = {
    'most-dangerous': '哪里最危险？',
    'why-dangerous': '为什么危险？',
    'what-check-first': '建议先检查什么？',
    summary: '给我一个整体巡检总结',
};

let currentSessionId = null;

assistantPreset?.addEventListener('change', () => {
    assistantQuestionInput.value = QUESTION_MAP[assistantPreset.value] || '';
    assistantQuestionInput?.focus();
});

assistantQuestionInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        askAssistant();
    }
});

btnAskAssistant?.addEventListener('click', askAssistant);
btnClearAssistantCache?.addEventListener('click', clearAssistantCache);
btnNewAssistantChat?.addEventListener('click', createNewChatSession);
btnToggleAssistantHistory?.addEventListener('click', toggleHistoryPanel);

initAssistant();

function initAssistant() {
    if (!assistantTask || !assistantTask.fileId || !assistantTask.hasPrediction) {
        renderAssistantEmpty('请先在点云分析页完成一次语义分割任务');
        return;
    }

    renderTaskCard(assistantTask);
    restoreHistoryPanelState();
    ensureActiveSession();
    renderSessionList();
    renderPersistedSession();
}

function renderTaskCard(taskState) {
    if (!assistantTaskCard) return;
    assistantTaskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">${escapeHtml(taskState.filename || taskState.fileId)}</div>
        <div class="sidebar-text">文件 ID：${escapeHtml(taskState.fileId)}</div>
        <div class="sidebar-text">分割状态：已完成</div>
        <div class="sidebar-text">当前分析结果与 AI 会话会按文件维度自动保留。</div>
    `;
}

function ensureActiveSession() {
    const currentTask = window.TaskState?.read?.();
    const sessions = getSessionsForCurrentFile();
    if (!currentTask?.fileId) {
        currentSessionId = null;
        return;
    }

    const storedCurrent = localStorage.getItem(ASSISTANT_CURRENT_SESSION_KEY);
    const existingCurrent = sessions.find((item) => item.id === storedCurrent);
    if (existingCurrent) {
        currentSessionId = existingCurrent.id;
        refreshSessionMeta(existingCurrent);
        return;
    }

    const latest = sessions[0];
    if (latest) {
        currentSessionId = latest.id;
        localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, latest.id);
        refreshSessionMeta(latest);
        return;
    }

    const created = createSessionRecord(currentTask.fileId);
    currentSessionId = created.id;
}

function createNewChatSession() {
    const currentTask = window.TaskState?.read?.();
    if (!currentTask?.fileId || !currentTask.hasPrediction) {
        renderAssistantEmpty('当前没有可用的分析结果');
        return;
    }

    const session = createSessionRecord(currentTask.fileId);
    currentSessionId = session.id;
    localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, session.id);
    renderSessionList();
    renderPersistedSession();
}

function createSessionRecord(fileId) {
    const sessions = readAssistantSessions();
    const now = new Date().toISOString();
    const next = {
        id: `session_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        fileId,
        title: '新建对话',
        createdAt: now,
        updatedAt: now,
        messages: [],
    };
    writeAssistantSessions([next, ...sessions]);
    refreshSessionMeta(next);
    return next;
}

function renderSessionList() {
    if (!assistantSessionList) {
        return;
    }

    const sessions = getSessionsForCurrentFile();
    if (!sessions.length) {
        assistantSessionList.innerHTML = '<div class="assistant-history__empty">当前文件还没有历史会话。</div>';
        return;
    }

    assistantSessionList.innerHTML = '';
    sessions.forEach((session) => {
        const item = document.createElement('div');
        item.className = `assistant-history__item${session.id === currentSessionId ? ' active' : ''}`;
        item.innerHTML = `
            <button type="button" class="assistant-history__main" data-open-session="${escapeHtml(session.id)}">
                <span class="assistant-history__item-title">${escapeHtml(session.title || '未命名对话')}</span>
                <span class="assistant-history__item-meta">${escapeHtml(formatSessionTime(session.updatedAt || session.createdAt))}</span>
                <span class="assistant-history__item-preview">${escapeHtml(buildSessionPreview(session))}</span>
            </button>
            <div class="assistant-history__actions">
                <button type="button" class="btn btn-outline btn-sm" data-rename-session="${escapeHtml(session.id)}">重命名</button>
                <button type="button" class="btn btn-outline btn-sm" data-delete-session="${escapeHtml(session.id)}">删除</button>
            </div>
        `;

        item.querySelector('[data-open-session]')?.addEventListener('click', () => {
            switchSession(session.id);
        });
        item.querySelector('[data-rename-session]')?.addEventListener('click', () => {
            renameSession(session.id);
        });
        item.querySelector('[data-delete-session]')?.addEventListener('click', () => {
            deleteSession(session.id);
        });

        assistantSessionList.appendChild(item);
    });
}

function switchSession(sessionId) {
    const session = getSessionsForCurrentFile().find((item) => item.id === sessionId);
    if (!session) {
        return;
    }
    currentSessionId = session.id;
    localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, session.id);
    renderSessionList();
    renderPersistedSession();
}

function renameSession(sessionId) {
    const sessions = readAssistantSessions();
    const index = sessions.findIndex((item) => item.id === sessionId);
    if (index < 0) return;

    const currentTitle = sessions[index].title || '未命名对话';
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle === null) return;

    const trimmed = nextTitle.trim().slice(0, 32);
    sessions[index] = {
        ...sessions[index],
        title: trimmed || currentTitle,
        updatedAt: new Date().toISOString(),
    };
    writeAssistantSessions(sessions);
    if (sessionId === currentSessionId) {
        refreshSessionMeta(sessions[index]);
    }
    renderSessionList();
    renderPersistedSession();
}

function deleteSession(sessionId) {
    const sessions = readAssistantSessions();
    const target = sessions.find((item) => item.id === sessionId);
    if (!target) return;

    const confirmed = window.confirm(`确定删除会话“${target.title || '未命名对话'}”吗？`);
    if (!confirmed) return;

    const filtered = sessions.filter((item) => item.id !== sessionId);
    writeAssistantSessions(filtered);

    if (currentSessionId === sessionId) {
        const next = getSessionsForCurrentFile(filtered)[0];
        if (next) {
            currentSessionId = next.id;
            localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, next.id);
            refreshSessionMeta(next);
        } else if (assistantTask?.fileId) {
            const created = createSessionRecord(assistantTask.fileId);
            currentSessionId = created.id;
            localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, created.id);
        } else {
            currentSessionId = null;
        }
    }

    renderSessionList();
    renderPersistedSession();
}

function renderPersistedSession() {
    const session = getCurrentSession();
    if (!session) {
        renderAssistantEmpty('当前没有可恢复的对话');
        return;
    }

    refreshSessionMeta(session);
    assistantChat.innerHTML = '';
    renderSessionDivider(session);

    if (!session.messages?.length) {
        renderAssistantEmptyBlock('请选择问题模板或输入自由问题，然后点击“发送”开始分析。');
        return;
    }

    session.messages.forEach((message) => {
        if (message.role === 'user') {
            appendUserBubble(message.content, false);
        } else {
            appendAssistantBubble({
                answer: message.content,
                model: message.model,
                provider: message.provider,
                fromCache: Boolean(message.fromCache),
                question: message.question,
                questionType: message.questionType,
                persist: false,
            });
        }
    });

    scrollAssistantToBottom();
}

async function askAssistant(regenerate = false) {
    const currentTask = window.TaskState?.read?.();
    if (!currentTask || !currentTask.fileId || !currentTask.hasPrediction) {
        renderAssistantEmpty('当前没有可用的分析结果');
        return;
    }

    if (!currentSessionId) {
        ensureActiveSession();
    }

    const questionType = assistantPreset?.value || '';
    const question = (assistantQuestionInput?.value || '').trim() || QUESTION_MAP[questionType] || '';
    if (!question) {
        renderAssistantEmpty('请选择问题模板或输入自由问题');
        return;
    }

    hideEmptyState();
    const cacheKey = buildCacheKey(currentTask.fileId, question);
    const cached = !regenerate ? readAssistantCache()[cacheKey] : null;
    appendUserBubble(question);

    if (cached) {
        appendAssistantBubble({
            answer: cached.answer,
            model: cached.model,
            provider: cached.provider,
            fromCache: true,
            question,
            questionType,
        });
        persistSessionMessage({
            role: 'assistant',
            content: cached.answer,
            model: cached.model,
            provider: cached.provider,
            fromCache: true,
            question,
            questionType,
        });
        scrollAssistantToBottom();
        return;
    }

    btnAskAssistant.disabled = true;
    const assistantState = appendStreamingAssistantBubble();
    let streamedText = '';
    let responseModel = '';
    let responseProvider = '';

    try {
        const res = await fetch(`${AI_API_BASE}/api/assistant/ask-stream`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: currentTask.fileId,
                question,
                question_type: questionType || null,
            }),
        });

        if (!res.ok || !res.body) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || 'AI 助手流式调用失败');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let done = false;

        while (!done) {
            const result = await reader.read();
            done = result.done;
            buffer += decoder.decode(result.value || new Uint8Array(), { stream: !done });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const eventBlock of events) {
                if (!eventBlock.trim()) continue;

                let eventName = 'message';
                const dataLines = [];
                eventBlock.split('\n').forEach((line) => {
                    if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5));
                    }
                });

                const rawData = dataLines.join('\n');
                let payload = {};
                try {
                    payload = rawData ? JSON.parse(rawData) : {};
                } catch (err) {
                    payload = { message: rawData, delta: rawData };
                }

                if (eventName === 'error') {
                    throw new Error(payload.message || 'AI 流式输出失败');
                }
                if (eventName === 'meta') {
                    responseModel = payload.model || responseModel;
                    responseProvider = payload.provider || responseProvider;
                    assistantState.meta.textContent = `模型：${responseModel || '未知'} | 提供方：${responseProvider || '未知'} | 来源：实时生成`;
                    continue;
                }
                if (eventName === 'done') {
                    done = true;
                    break;
                }
                if (eventName === 'chunk') {
                    streamedText += payload.delta || '';
                    assistantState.content.innerHTML = renderStreamingPreview(streamedText);
                    scrollAssistantToBottom();
                }
            }
        }

        writeAssistantCache(cacheKey, {
            answer: streamedText,
            model: responseModel || 'unknown',
            provider: responseProvider || 'unknown',
            updatedAt: new Date().toISOString(),
        });

        assistantState.title.textContent = '模型回答';
        assistantState.content.innerHTML = renderMarkdownAnswer(streamedText);
        assistantState.meta.textContent = `模型：${responseModel || '未知'} | 提供方：${responseProvider || '未知'} | 来源：实时生成`;
        appendAnswerActions(assistantState.bubble, {
            question,
            answer: streamedText,
            questionType,
        });
        persistSessionMessage({
            role: 'assistant',
            content: streamedText,
            model: responseModel || 'unknown',
            provider: responseProvider || 'unknown',
            fromCache: false,
            question,
            questionType,
        });
    } catch (err) {
        assistantState.title.textContent = '调用失败';
        assistantState.content.innerHTML = `<p>${escapeHtml(err.message || 'AI 助手调用失败')}</p>`;
        assistantState.meta.textContent = '';
    } finally {
        btnAskAssistant.disabled = false;
        scrollAssistantToBottom();
    }
}

function appendUserBubble(question, persist = true) {
    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble user';
    bubble.innerHTML = `<div>${escapeHtml(question)}</div>`;
    assistantChat.appendChild(bubble);
    if (persist) {
        persistSessionMessage({
            role: 'user',
            content: question,
        });
    }
}

function appendStreamingAssistantBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble assistant';
    bubble.innerHTML = `
        <div class="assistant-answer-title">AI 正在分析</div>
        <div class="assistant-answer-content"></div>
        <div class="assistant-meta">输出模式：流式返回</div>
    `;
    assistantChat.appendChild(bubble);
    scrollAssistantToBottom();
    return {
        bubble,
        title: bubble.querySelector('.assistant-answer-title'),
        content: bubble.querySelector('.assistant-answer-content'),
        meta: bubble.querySelector('.assistant-meta'),
    };
}

function appendAssistantBubble({ answer, model, provider, fromCache, question, questionType, persist = false }) {
    const safeModel = model || '未知';
    const safeProvider = provider || '未知';
    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble assistant';
    bubble.innerHTML = `
        <div class="assistant-answer-title">模型回答</div>
        <div class="assistant-answer-content">${renderMarkdownAnswer(answer || '模型没有返回有效内容')}</div>
        <div class="assistant-meta">模型：${escapeHtml(safeModel)} | 提供方：${escapeHtml(safeProvider)} | 来源：${fromCache ? '本地缓存' : '实时生成'}</div>
    `;
    assistantChat.appendChild(bubble);
    appendAnswerActions(bubble, { question, answer, questionType });

    if (persist) {
        persistSessionMessage({
            role: 'assistant',
            content: answer,
            model,
            provider,
            fromCache,
            question,
            questionType,
        });
    }
}

function appendAnswerActions(bubble, context) {
    const actions = document.createElement('div');
    actions.className = 'assistant-answer-actions';
    actions.innerHTML = `
        <button class="btn btn-outline btn-sm" data-action="regenerate">重新生成</button>
        <button class="btn btn-outline btn-sm" data-action="copy">复制回答</button>
        <button class="btn btn-outline btn-sm" data-action="export">导出 Markdown</button>
    `;

    actions.querySelector('[data-action="regenerate"]')?.addEventListener('click', async () => {
        assistantQuestionInput.value = context.question;
        if (assistantPreset && context.questionType) {
            assistantPreset.value = context.questionType;
        }
        await askAssistant(true);
    });

    actions.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(context.answer || '');
        } catch (err) {
            console.warn('Failed to copy answer.', err);
        }
    });

    actions.querySelector('[data-action="export"]')?.addEventListener('click', () => {
        exportMarkdown(context.question, context.answer);
    });

    bubble.appendChild(actions);
}

function renderSessionDivider(session) {
    const divider = document.createElement('div');
    divider.className = 'assistant-session-divider';
    divider.innerHTML = `<span>会话 ${escapeHtml(buildSessionTitle(session))}</span>`;
    assistantChat.appendChild(divider);
}

function renderAssistantEmpty(message) {
    if (assistantTaskCard) {
        assistantTaskCard.innerHTML = `
            <div class="sidebar-label">当前任务</div>
            <div class="sidebar-value">未分析</div>
            <div class="sidebar-text">${escapeHtml(message)}</div>
        `;
    }
    if (assistantChat) {
        assistantChat.innerHTML = `<div class="assistant-empty">${escapeHtml(message)}</div>`;
    }
}

function renderAssistantEmptyBlock(message) {
    const block = document.createElement('div');
    block.className = 'assistant-empty assistant-empty--compact';
    block.textContent = message;
    assistantChat.appendChild(block);
}

function getSessionsForCurrentFile(sessions = readAssistantSessions()) {
    const fileId = window.TaskState?.read?.()?.fileId;
    return sessions
        .filter((item) => item.fileId === fileId)
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

function readAssistantCache() {
    try {
        return JSON.parse(localStorage.getItem(ASSISTANT_CACHE_KEY) || '{}');
    } catch (err) {
        console.warn('Failed to read assistant cache.', err);
        return {};
    }
}

function writeAssistantCache(key, value) {
    const cache = readAssistantCache();
    cache[key] = value;
    try {
        const trimmed = Object.fromEntries(
            Object.entries(cache)
                .sort((a, b) => new Date(b[1]?.updatedAt || 0).getTime() - new Date(a[1]?.updatedAt || 0).getTime())
                .slice(0, MAX_CACHE_ENTRIES)
        );
        localStorage.setItem(ASSISTANT_CACHE_KEY, JSON.stringify(trimmed));
    } catch (err) {
        console.warn('Failed to write assistant cache.', err);
    }
}

function clearAssistantCache() {
    localStorage.removeItem(ASSISTANT_CACHE_KEY);
    const session = getCurrentSession();
    refreshSessionMeta(session, '缓存已清空，后续回答将重新生成。');
}

function readAssistantSessions() {
    try {
        const raw = localStorage.getItem(ASSISTANT_SESSIONS_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('Failed to read assistant sessions.', err);
        return [];
    }
}

function writeAssistantSessions(sessions) {
    try {
        localStorage.setItem(ASSISTANT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSION_COUNT)));
    } catch (err) {
        console.warn('Failed to write assistant sessions.', err);
    }
}

function getCurrentSession() {
    return readAssistantSessions().find((item) => item.id === currentSessionId) || null;
}

function persistSessionMessage(message) {
    if (!currentSessionId || !assistantTask?.fileId) {
        return;
    }

    const sessions = readAssistantSessions();
    const index = sessions.findIndex((item) => item.id === currentSessionId);
    if (index < 0) return;

    const now = new Date().toISOString();
    const nextMessage = {
        ...message,
        id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        createdAt: now,
    };

    const session = { ...sessions[index] };
    session.messages = [...(session.messages || []), nextMessage].slice(-MAX_MESSAGES_PER_SESSION);
    session.updatedAt = now;
    if (!session.title || session.title === '新建对话') {
        const firstUser = session.messages.find((item) => item.role === 'user');
        if (firstUser?.content) {
            session.title = String(firstUser.content).trim().slice(0, 24);
        }
    }

    sessions.splice(index, 1);
    sessions.unshift(session);
    writeAssistantSessions(sessions);
    localStorage.setItem(ASSISTANT_CURRENT_SESSION_KEY, session.id);
    currentSessionId = session.id;
    refreshSessionMeta(session);
    renderSessionList();
}

function refreshSessionMeta(session, hint) {
    if (assistantWorkbenchTitle) {
        assistantWorkbenchTitle.textContent = session?.title || '当前对话';
    }
    if (assistantSessionTip) {
        const base = session ? `当前会话：${buildSessionTitle(session)}` : '当前没有会话';
        assistantSessionTip.textContent = hint ? `${base}，${hint}` : `${base}，离开页面后会自动保留。`;
    }
}

function restoreHistoryPanelState() {
    const collapsed = localStorage.getItem(ASSISTANT_HISTORY_COLLAPSED_KEY) === '1';
    setHistoryPanelCollapsed(collapsed);
}

function toggleHistoryPanel() {
    const collapsed = !assistantHistoryPanel?.classList.contains('collapsed');
    setHistoryPanelCollapsed(collapsed);
}

function setHistoryPanelCollapsed(collapsed) {
    if (!assistantHistoryPanel || !assistantShell) {
        return;
    }
    assistantHistoryPanel.classList.toggle('collapsed', collapsed);
    assistantShell.classList.toggle('history-collapsed', collapsed);
    localStorage.setItem(ASSISTANT_HISTORY_COLLAPSED_KEY, collapsed ? '1' : '0');
    const label = collapsed ? '展开' : '折叠';
    if (btnToggleAssistantHistory) {
        btnToggleAssistantHistory.textContent = label;
    }
}

function buildSessionTitle(session) {
    return `${session?.title || '未命名'} · ${formatSessionTime(session?.updatedAt || session?.createdAt)}`;
}

function buildSessionPreview(session) {
    const messages = session.messages || [];
    const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant');
    const lastUser = [...messages].reverse().find((item) => item.role === 'user');
    const text = lastAssistant?.content || lastUser?.content || '暂无内容';
    return String(text).replace(/\s+/g, ' ').slice(0, 46);
}

function formatSessionTime(value) {
    const date = value ? new Date(value) : new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
}

function buildCacheKey(fileId, question) {
    return `${fileId}::${question.trim()}`;
}

function hideEmptyState() {
    assistantEmptyState?.remove();
    assistantChat?.querySelectorAll('.assistant-empty')?.forEach((node) => node.remove());
}

function scrollAssistantToBottom() {
    assistantChat.scrollTop = assistantChat.scrollHeight;
}

function renderStreamingPreview(text) {
    return `<div style="white-space:pre-wrap;">${escapeHtml(String(text || ''))}</div>`;
}

function renderMarkdownAnswer(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return '<p>模型没有返回有效内容。</p>';

    const lines = normalized.split('\n');
    const blocks = [];
    let paragraphBuffer = [];
    let listBuffer = null;
    let codeBuffer = [];
    let inCodeBlock = false;

    const flushParagraph = () => {
        if (!paragraphBuffer.length) return;
        blocks.push(`<p>${paragraphBuffer.map((line) => formatInlineMarkdown(line)).join('<br>')}</p>`);
        paragraphBuffer = [];
    };

    const flushList = () => {
        if (!listBuffer || !listBuffer.items.length) {
            listBuffer = null;
            return;
        }
        const tag = listBuffer.type === 'ol' ? 'ol' : 'ul';
        blocks.push(`<${tag}>${listBuffer.items.join('')}</${tag}>`);
        listBuffer = null;
    };

    const flushCode = () => {
        if (!codeBuffer.length) return;
        blocks.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
    };

    lines.forEach((rawLine) => {
        const line = rawLine.replace(/\t/g, '    ');
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            flushParagraph();
            flushList();
            if (inCodeBlock) {
                flushCode();
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
            }
            return;
        }

        if (inCodeBlock) {
            codeBuffer.push(line);
            return;
        }

        if (!trimmed) {
            flushParagraph();
            flushList();
            return;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const level = Math.min(headingMatch[1].length, 4);
            blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
            return;
        }

        const quoteMatch = trimmed.match(/^>\s?(.*)$/);
        if (quoteMatch) {
            flushParagraph();
            flushList();
            blocks.push(`<blockquote>${formatInlineMarkdown(quoteMatch[1])}</blockquote>`);
            return;
        }

        const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
        if (ulMatch) {
            flushParagraph();
            if (!listBuffer || listBuffer.type !== 'ul') {
                flushList();
                listBuffer = { type: 'ul', items: [] };
            }
            listBuffer.items.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
            return;
        }

        const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (olMatch) {
            flushParagraph();
            if (!listBuffer || listBuffer.type !== 'ol') {
                flushList();
                listBuffer = { type: 'ol', items: [] };
            }
            listBuffer.items.push(`<li>${formatInlineMarkdown(olMatch[2])}</li>`);
            return;
        }

        flushList();
        paragraphBuffer.push(trimmed);
    });

    flushParagraph();
    flushList();
    if (inCodeBlock) flushCode();
    return blocks.join('');
}

function formatInlineMarkdown(text) {
    let escaped = escapeHtml(text);
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
    return escaped;
}

function exportMarkdown(question, answer) {
    const content = `# AI 助手回答\n\n## 问题\n\n${question || ''}\n\n## 回答\n\n${answer || ''}\n`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `assistant_answer_${Date.now()}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
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
