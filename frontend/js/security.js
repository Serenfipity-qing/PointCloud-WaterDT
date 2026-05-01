const SECURITY_API_BASE = window.WATER_TWIN_API || '';

const lockStateEl = document.getElementById('securityLockState');
const failedCountEl = document.getElementById('securityFailedCount');
const lastLoginEl = document.getElementById('securityLastLogin');
const lastIpEl = document.getElementById('securityLastIp');
const logsEl = document.getElementById('securityLogs');

loadSecurityOverview();

async function loadSecurityOverview() {
    try {
        const res = await fetch(`${SECURITY_API_BASE}/api/auth/security-overview`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error('读取安全信息失败');
        }
        const data = await res.json();
        renderOverview(data);
    } catch (err) {
        if (logsEl) logsEl.innerHTML = `<div class="empty-copy">${err.message || '读取失败'}</div>`;
    }
}

function renderOverview(data) {
    if (lockStateEl) {
        lockStateEl.textContent = data.is_locked ? '已锁定' : '正常';
    }
    if (failedCountEl) {
        failedCountEl.textContent = String(data.failed_attempts ?? 0);
    }
    if (lastLoginEl) {
        lastLoginEl.textContent = data.last_login_at ? formatDateTime(data.last_login_at) : '-';
    }
    if (lastIpEl) {
        lastIpEl.textContent = data.last_login_ip || '-';
    }
    if (logsEl) {
        const rows = data.recent_logs || [];
        logsEl.innerHTML = rows.length ? rows.map((item) => `
            <div class="stack-row" style="align-items:start;gap:14px;">
                <div style="min-width:130px;color:var(--text-light);font-size:12px;">${formatDateTime(item.created_at)}</div>
                <div style="flex:1;">
                    <div style="font-weight:700;">${formatEventType(item.event_type)} ${item.success ? '成功' : '失败'}</div>
                    <div style="font-size:12px;color:var(--text-light);margin-top:4px;">IP：${item.ip_address || '-'}${item.detail ? ` | ${item.detail}` : ''}</div>
                </div>
            </div>
        `).join('') : '<div class="empty-copy">暂无安全事件记录</div>';
    }
}

function formatEventType(type) {
    const map = {
        login_success: '登录',
        login_failed: '登录',
        login_blocked_locked: '登录',
        account_locked: '账号锁定',
        register: '注册',
        change_password: '修改密码',
        unlock_success: '账号解锁',
        unlock_failed: '账号解锁',
    };
    return map[type] || type;
}

function formatDateTime(value) {
    try {
        return new Date(value).toLocaleString('zh-CN');
    } catch {
        return value || '-';
    }
}
