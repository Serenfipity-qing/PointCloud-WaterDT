window.WATER_TWIN_API = window.WATER_TWIN_API || '';
const AUTH_API_BASE = window.WATER_TWIN_API;

const path = window.location.pathname.toLowerCase();
const pageName = path.split('/').pop();
const isAuthPage = ['login.html', 'register.html', 'change-password.html'].includes(pageName);

if (pageName === 'login.html') {
    initLoginPage();
} else if (pageName === 'register.html') {
    initRegisterPage();
} else if (pageName === 'change-password.html') {
    initChangePasswordPage();
} else if (!isAuthPage) {
    guardPage();
}

async function guardPage() {
    try {
        const res = await fetch(`${AUTH_API_BASE}/api/auth/me`, { credentials: 'include' });
        if (!res.ok) {
            redirectToLogin();
            return;
        }
        const data = await res.json();
        injectUserMenu(data.username);
    } catch (err) {
        redirectToLogin();
    }
}

function redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?next=${next}`;
}

function commonSubmit(binding, requestFn) {
    const form = document.getElementById(binding.formId);
    const btn = document.getElementById(binding.buttonId);
    const errorEl = document.getElementById(binding.errorId);

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form || !btn || !errorEl) return;

        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = '处理中...';

        try {
            await requestFn(form);
        } catch (err) {
            errorEl.textContent = err.message || '操作失败';
        } finally {
            btn.disabled = false;
            btn.textContent = binding.buttonText;
        }
    });
}

function initLoginPage() {
    commonSubmit(
        { formId: 'loginForm', buttonId: 'btnLogin', errorId: 'loginError', buttonText: '登录' },
        async (form) => {
            const formData = new FormData(form);
            const payload = {
                username: String(formData.get('username') || '').trim(),
                password: String(formData.get('password') || ''),
                remember_me: Boolean(formData.get('remember_me')),
            };

            const res = await fetch(`${AUTH_API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: '登录失败' }));
                throw new Error(error.detail || '登录失败');
            }

            const next = new URLSearchParams(window.location.search).get('next') || '/index.html';
            window.location.href = next;
        }
    );
}

function initRegisterPage() {
    commonSubmit(
        { formId: 'registerForm', buttonId: 'btnRegister', errorId: 'registerError', buttonText: '注册' },
        async (form) => {
            const formData = new FormData(form);
            const username = String(formData.get('username') || '').trim();
            const password = String(formData.get('password') || '');
            const confirmPassword = String(formData.get('confirm_password') || '');
            if (password !== confirmPassword) {
                throw new Error('两次密码不一致');
            }
            validateAuthInput(username, password);

            const payload = {
                username,
                password,
            };

            const res = await fetch(`${AUTH_API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: '注册失败' }));
                throw new Error(error.detail || '注册失败');
            }

            window.location.href = '/login.html';
        }
    );
}

function initChangePasswordPage() {
    commonSubmit(
        { formId: 'changePasswordForm', buttonId: 'btnChangePassword', errorId: 'changePasswordError', buttonText: '修改密码' },
        async (form) => {
            const formData = new FormData(form);
            const newPassword = String(formData.get('new_password') || '');
            const confirmPassword = String(formData.get('confirm_password') || '');
            if (newPassword !== confirmPassword) {
                throw new Error('两次新密码不一致');
            }
            validatePasswordStrength(newPassword);

            const payload = {
                current_password: String(formData.get('current_password') || ''),
                new_password: newPassword,
            };

            const res = await fetch(`${AUTH_API_BASE}/api/auth/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: '修改失败' }));
                throw new Error(error.detail || '修改失败');
            }

            window.location.href = '/index.html';
        }
    );
}

function injectUserMenu(username) {
    if (document.querySelector('[data-user-menu]')) {
        return;
    }

    const menu = document.createElement('div');
    menu.dataset.userMenu = '1';
    menu.className = 'user-menu';
    menu.innerHTML = `
        <button type="button" class="user-menu__trigger" data-user-trigger>
            <span class="user-menu__avatar">${escapeHtml(String(username || 'U')).slice(0, 1).toUpperCase()}</span>
            <span>当前用户：${escapeHtml(username || '未命名')}</span>
        </button>
        <div class="user-menu__dropdown">
            <a href="/register.html">注册账号</a>
            <a href="/change-password.html">修改密码</a>
            <button type="button" data-logout>退出登录</button>
        </div>
    `;

    menu.querySelector('[data-user-trigger]')?.addEventListener('click', () => {
        menu.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target)) {
            menu.classList.remove('open');
        }
    });

    menu.querySelector('[data-logout]')?.addEventListener('click', async () => {
        await fetch(`${AUTH_API_BASE}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        }).catch(() => null);
        window.location.href = '/login.html';
    });

    document.body.appendChild(menu);
}

function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;',
    }[char]));
}

function validateAuthInput(username, password) {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
        throw new Error('用户名需为 3-32 位，可包含字母、数字、下划线、点和短横线');
    }
    validatePasswordStrength(password);
}

function validatePasswordStrength(password) {
    const isStrong = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/.test(password);
    if (!isStrong) {
        throw new Error('密码需为 8-64 位，且至少包含字母、数字和特殊字符');
    }
}
