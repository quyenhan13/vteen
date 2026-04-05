/**
 * VTEEN CORE ENGINE - Git-Native Static & GitHub API Storage
 */
(function (window) {
    'use strict';

    const FALLBACK_POSTER = 'uploads/posters/poster_1777079252132.jpg';
    const STORAGE_KEYS = {
        SESSION: 'vteen_auth_session_v1',
        GH_CONFIG: 'vteen_github_config_v1',
        MOVIES_CACHE: 'vteen_movies_override_v4',
        IMAGES_CACHE: 'vteen_images_override_v1',
        DRIVE_CACHE: 'vteen_drive_override_v1',
        USERS_CACHE: 'vteen_users_override_v1'
    };

    try {
        ['vteen_movies_override_v1', 'vteen_movies_override_v2', 'vteen_movies_override_v3'].forEach(k => localStorage.removeItem(k));
    } catch (e) {}

    function isSubFolder() {
        const path = window.location.pathname.replace(/\\/g, '/');
        return /\/(admin|tube|driver)(\/|$)/.test(path);
    }

    function rootPrefix() {
        return isSubFolder() ? '../' : '';
    }

    function resolveUrl(relPath) {
        if (!relPath) return '';
        const clean = String(relPath).trim();
        if (/^(https?:|data:|blob:)/i.test(clean)) return clean;
        return rootPrefix() + clean.replace(/^\/+/, '');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function slugify(str) {
        let s = String(str || '').trim().toLowerCase();
        s = s.replace(/(à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ)/g, 'a');
        s = s.replace(/(è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ)/g, 'e');
        s = s.replace(/(ì|í|ị|ỉ|ĩ)/g, 'i');
        s = s.replace(/(ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ)/g, 'o');
        s = s.replace(/(ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ)/g, 'u');
        s = s.replace(/(ỳ|ý|ỵ|ỷ|ỹ)/g, 'y');
        s = s.replace(/(đ)/g, 'd');
        s = s.replace(/[^a-z0-9-\s]/g, '');
        s = s.replace(/([\s-]+)/g, '-');
        return s.replace(/^-+|-+$/g, '');
    }

    function getPosterUrl(poster) {
        const p = String(poster || '').trim();
        if (!p) return resolveUrl(FALLBACK_POSTER);
        if (/^(https?:|data:|blob:)/i.test(p)) return p;
        return resolveUrl(p);
    }

    function getFallbackPoster() {
        return resolveUrl(FALLBACK_POSTER);
    }

    function normalizeMovieUrl(rawUrl) {
        let link = String(rawUrl || '').trim();
        if (!link) return '';
        const clbMatch = link.match(/clbphimxua\.com\/clbpx\.html\?v=([A-Za-z0-9_-]+)/i);
        if (clbMatch) return `https://abysscdn.com/?v=${clbMatch[1]}`;
        const shortMatch = link.match(/short\.icu\/([A-Za-z0-9_-]+)/i);
        if (shortMatch) return `https://abysscdn.com/?v=${shortMatch[1]}`;
        const driveMatch = link.match(/drive\.google\.com\/.*?\/d\/([^/]+)/i);
        if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
        const dmMatch = link.match(/(?:dailymotion\.com\/video|dai\.ly)\/([a-z0-9]+)/i);
        if (dmMatch) return `https://www.dailymotion.com/embed/video/${dmMatch[1]}?autoplay=1`;
        return link;
    }

    function processAndCleanLinks(text) {
        const raw = String(text || '');
        const found = [];
        const hrefRe = /href=["'](.*?)["']/gi;
        let m;
        while ((m = hrefRe.exec(raw)) !== null) {
            if (m[1]) found.push(m[1]);
        }
        const urlRe = /https?:\/\/[^\s<>"']+/gi;
        while ((m = urlRe.exec(raw)) !== null) {
            if (m[0]) found.push(m[0]);
        }

        const unique = [...new Set(found.map(x => x.trim()).filter(Boolean))];
        const clean = [];
        for (let link of unique) {
            try {
                new URL(link);
                clean.push(normalizeMovieUrl(link));
            } catch (e) {}
        }
        return clean;
    }

    // --- AUTHENTICATION ---
    const auth = {
        getSession() {
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (data && data.username) return data;
            } catch (e) {}
            return null;
        },
        isLoggedIn() {
            return !!this.getSession();
        },
        isAdmin() {
            const s = this.getSession();
            return !!(s && s.role === 'admin');
        },
        setSession(username, role) {
            const payload = { username, role, time: Date.now() };
            localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(payload));
            return payload;
        },
        logout() {
            localStorage.removeItem(STORAGE_KEYS.SESSION);
        },
        async loadBcrypt() {
            if (window.dcodeIO && window.dcodeIO.bcrypt) return window.dcodeIO.bcrypt;
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js';
                s.onload = () => resolve(window.dcodeIO && window.dcodeIO.bcrypt);
                s.onerror = () => reject(new Error('Không thể tải thư viện xác thực bcryptjs'));
                document.head.appendChild(s);
            });
        },
        async verifyLogin(username, password, requireAdmin = false) {
            const users = await db.getUsers();
            const user = users.find(u => String(u.username).toLowerCase() === String(username).trim().toLowerCase());
            if (!user) {
                return { ok: false, msg: 'Sai tài khoản hoặc mật khẩu.' };
            }
            if (requireAdmin && user.role !== 'admin') {
                return { ok: false, msg: 'Tài khoản này không có quyền Quản trị viên!' };
            }
            const bcrypt = await this.loadBcrypt();
            const normalizedHash = String(user.password || '').replace(/^\$2y\$/, '$2a$');
            const matched = bcrypt.compareSync(String(password), normalizedHash);
            if (!matched) {
                return { ok: false, msg: 'Sai tài khoản hoặc mật khẩu.' };
            }
            this.setSession(user.username, user.role || 'user');
            return { ok: true, user };
        },
        async changePassword(username, currentPassword, newPassword) {
            const users = await db.getUsers();
            const idx = users.findIndex(u => String(u.username).toLowerCase() === String(username).trim().toLowerCase());
            if (idx === -1) {
                return { ok: false, msg: 'Không tìm thấy tài khoản admin.' };
            }
            const bcrypt = await this.loadBcrypt();
            const currentHash = String(users[idx].password || '').replace(/^\$2y\$/, '$2a$');
            if (!bcrypt.compareSync(String(currentPassword), currentHash)) {
                return { ok: false, msg: 'Mật khẩu hiện tại không đúng.' };
            }
            if (bcrypt.compareSync(String(newPassword), currentHash)) {
                return { ok: false, msg: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.' };
            }
            const salt = bcrypt.genSaltSync(10);
            const newHash = bcrypt.hashSync(String(newPassword), salt).replace(/^\$2a\$/, '$2y$');
            users[idx].password = newHash;
            await db.saveUsers(users, `Update password for ${username}`);
            return { ok: true, msg: 'Đã đổi mật khẩu admin thành công.' };
        }
    };

    // --- GITHUB API INTEGRATION ---
    const github = {
        getConfig() {
            let saved = {};
            try {
                saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.GH_CONFIG) || '{}');
            } catch (e) {}

            // Auto-detect owner & repo from *.github.io URL if not set
            let autoOwner = 'quyenhan13';
            let autoRepo = 'vteen';
            const host = window.location.hostname;
            if (host.endsWith('.github.io')) {
                autoOwner = host.replace('.github.io', '');
                const parts = window.location.pathname.split('/').filter(Boolean);
                if (parts.length > 0 && !parts[0].endsWith('.html')) {
                    autoRepo = parts[0];
                }
            }
            return {
                owner: saved.owner || autoOwner,
                repo: saved.repo || autoRepo,
                branch: saved.branch || 'main',
                token: saved.token || ''
            };
        },
        saveConfig(cfg) {
            localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify({
                owner: String(cfg.owner || '').trim(),
                repo: String(cfg.repo || '').trim(),
                branch: String(cfg.branch || 'main').trim() || 'main',
                token: String(cfg.token || '').trim()
            }));
        },
        isConfigured() {
            const c = this.getConfig();
            return !!(c.owner && c.repo && c.token);
        },
        toBase64Utf8(str) {
            const bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        },
        arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            return btoa(binary);
        },
        async getFileSha(path) {
            const c = this.getConfig();
            const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`;
            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${c.token}`,
                    'Accept': 'application/vnd.github+json'
                }
            });
            if (res.status === 404) return null;
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `GitHub API HTTP ${res.status}`);
            }
            const data = await res.json();
            return data.sha || null;
        },
        async putContent(path, base64Content, message) {
            if (!this.isConfigured()) {
                return { synced: false, reason: 'not_configured' };
            }
            const c = this.getConfig();
            const sha = await this.getFileSha(path);
            const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
            const body = {
                message: message || `Update ${path}`,
                content: base64Content,
                branch: c.branch
            };
            if (sha) body.sha = sha;

            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${c.token}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `Lỗi lưu GitHub (${res.status})`);
            }
            return { synced: true };
        },
        async deleteContent(path, message) {
            if (!this.isConfigured()) return { synced: false };
            const c = this.getConfig();
            const sha = await this.getFileSha(path);
            if (!sha) return { synced: false };
            const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
            const res = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${c.token}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message || `Delete ${path}`,
                    sha,
                    branch: c.branch
                })
            });
            return { synced: res.ok };
        },
        async saveJsonFile(path, data, message) {
            const jsonStr = JSON.stringify(data, null, 2);
            return this.putContent(path, this.toBase64Utf8(jsonStr), message);
        },
        async uploadFile(path, file, message) {
            const buffer = await file.arrayBuffer();
            const b64 = this.arrayBufferToBase64(buffer);
            return this.putContent(path, b64, message);
        }
    };

    // --- DATABASE LAYER (JSON + Local Override + GitHub Commit) ---
    let memoryMovies = null;
    let memoryImages = null;
    let memoryDrive = null;
    let memoryPosters = null;
    let memoryUsers = null;

    async function fetchJson(relPath, fallback = []) {
        try {
            const res = await fetch(resolveUrl(relPath) + '?v=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return fallback;
            return await res.json();
        } catch (e) {
            return fallback;
        }
    }

    const db = {
        async getMovies() {
            if (memoryMovies) return memoryMovies;
            const localRaw = localStorage.getItem(STORAGE_KEYS.MOVIES_CACHE);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        memoryMovies = parsed;
                        return memoryMovies;
                    }
                } catch (e) {}
            }
            memoryMovies = await fetchJson('data/movies.json', []);
            return memoryMovies;
        },
        async saveMovies(movies, commitMsg = 'Update movies.json via VTEEN Admin') {
            memoryMovies = movies;
            try {
                localStorage.setItem(STORAGE_KEYS.MOVIES_CACHE, JSON.stringify(movies));
            } catch (e) {}
            if (github.isConfigured()) {
                return await github.saveJsonFile('data/movies.json', movies, commitMsg);
            }
            return { synced: false };
        },
        async getImages() {
            if (memoryImages) return memoryImages;
            const localRaw = localStorage.getItem(STORAGE_KEYS.IMAGES_CACHE);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed)) {
                        memoryImages = parsed;
                        return memoryImages;
                    }
                } catch (e) {}
            }
            memoryImages = await fetchJson('data/images.json', []);
            return memoryImages;
        },
        async saveImages(images, commitMsg = 'Update images.json via VTEEN') {
            memoryImages = images;
            try {
                localStorage.setItem(STORAGE_KEYS.IMAGES_CACHE, JSON.stringify(images));
            } catch (e) {}
            if (github.isConfigured()) {
                return await github.saveJsonFile('data/images.json', images, commitMsg);
            }
            return { synced: false };
        },
        async getDriveFiles() {
            if (memoryDrive) return memoryDrive;
            const localRaw = localStorage.getItem(STORAGE_KEYS.DRIVE_CACHE);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed)) {
                        memoryDrive = parsed;
                        return memoryDrive;
                    }
                } catch (e) {}
            }
            memoryDrive = await fetchJson('data/drive.json', []);
            return memoryDrive;
        },
        async saveDriveFiles(files, commitMsg = 'Update drive.json via VTEEN Drive') {
            memoryDrive = files;
            try {
                localStorage.setItem(STORAGE_KEYS.DRIVE_CACHE, JSON.stringify(files));
            } catch (e) {}
            if (github.isConfigured()) {
                return await github.saveJsonFile('data/drive.json', files, commitMsg);
            }
            return { synced: false };
        },
        async getPosters() {
            if (memoryPosters) return memoryPosters;
            memoryPosters = await fetchJson('data/posters.json', [FALLBACK_POSTER]);
            return memoryPosters;
        },
        async getUsers() {
            if (memoryUsers) return memoryUsers;
            const localRaw = localStorage.getItem(STORAGE_KEYS.USERS_CACHE);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        memoryUsers = parsed;
                        return memoryUsers;
                    }
                } catch (e) {}
            }
            memoryUsers = await fetchJson('data/users.json', []);
            return memoryUsers;
        },
        async saveUsers(users, commitMsg = 'Update users.json via VTEEN Admin') {
            memoryUsers = users;
            try {
                localStorage.setItem(STORAGE_KEYS.USERS_CACHE, JSON.stringify(users));
            } catch (e) {}
            if (github.isConfigured()) {
                return await github.saveJsonFile('data/users.json', users, commitMsg);
            }
            return { synced: false };
        },
        async getYouTubeDefault() {
            return await fetchJson('data/youtube_default.json', []);
        },
        clearLocalOverrides() {
            localStorage.removeItem(STORAGE_KEYS.MOVIES_CACHE);
            localStorage.removeItem(STORAGE_KEYS.IMAGES_CACHE);
            localStorage.removeItem(STORAGE_KEYS.DRIVE_CACHE);
            localStorage.removeItem(STORAGE_KEYS.USERS_CACHE);
            memoryMovies = null;
            memoryImages = null;
            memoryDrive = null;
            memoryUsers = null;
        },
        async getGroupedMovies(searchQuery = '') {
            const all = await this.getMovies();
            const q = String(searchQuery || '').trim().toLowerCase();
            const groups = new Map();

            for (const row of all) {
                const title = String(row.title || '').trim();
                const seriesName = String(row.series_name || '').trim();
                if (q && !title.toLowerCase().includes(q) && !seriesName.toLowerCase().includes(q)) {
                    continue;
                }
                const displayName = seriesName !== '' ? seriesName : title;
                if (!displayName) continue;

                const epNum = parseInt(row.episode, 10) || 1;
                const current = groups.get(displayName);
                if (!current) {
                    groups.set(displayName, {
                        display_name: displayName,
                        poster: row.poster || '',
                        slug: row.slug || slugify(displayName),
                        total_eps: 1,
                        latest_ep: epNum
                    });
                } else {
                    current.total_eps += 1;
                    if (epNum > current.latest_ep) current.latest_ep = epNum;
                    if (!current.poster && row.poster) current.poster = row.poster;
                    if (!current.slug && row.slug) current.slug = row.slug;
                }
            }

            return Array.from(groups.values()).sort((a, b) =>
                a.display_name.localeCompare(b.display_name, 'vi')
            );
        }
    };

    // --- UI / NAVBAR INITIALIZATION ---
    function initNavbar() {
        const menu = document.getElementById('mainMenu');
        if (!menu) return;

        const loggedIn = auth.isLoggedIn();
        const isAdmin = auth.isAdmin();
        const path = window.location.pathname.replace(/\\/g, '/');
        const isHome = /(^|\/)(index\.html)?$/.test(path) && !isSubFolder() && !window.location.search.includes('login=1');
        const isPhim = /phim\.html$/.test(path);
        const isDriver = /\/driver(\/|$)|driver\.html$/.test(path);
        const isTube = /\/tube(\/|$)/.test(path);
        const isLogin = /login\.html$/.test(path) || window.location.search.includes('login=1');
        const isAdminPage = /\/admin(\/|$)/.test(path);

        menu.innerHTML = `
            <a href="${resolveUrl('index.html')}" class="${isHome ? 'active' : ''}">
                <i class="fa fa-upload"></i>
                <span>Cap nhat</span>
            </a>
            <a href="${resolveUrl('phim.html')}" class="${isPhim ? 'active' : ''}">
                <i class="fa fa-film"></i>
                <span>Phim</span>
            </a>
            <a href="${resolveUrl('driver/index.html')}" class="${isDriver ? 'active' : ''}">
                <i class="fa-brands fa-google-drive" style="color: #00f2ff;"></i>
                <span>Driver</span>
            </a>
            <a href="${resolveUrl('tube/index.html')}" class="${isTube ? 'active' : ''}">
                <i class="fa-brands fa-youtube" style="color: #ff0000;"></i>
                <span>Tube</span>
            </a>
            ${isAdmin ? `
                <a href="${resolveUrl('admin/index.html')}" class="${isAdminPage ? 'active' : ''}">
                    <i class="fa fa-user-shield"></i>
                    <span>Admin</span>
                </a>
            ` : ''}
            ${!loggedIn ? `
                <a href="${resolveUrl('login.html')}" class="${isLogin ? 'active' : ''}">
                    <i class="fa fa-user-shield"></i>
                    <span>Login</span>
                </a>
            ` : `
                <a href="#" id="vteenLogoutBtn" class="logout-link" title="Dang xuat">
                    <i class="fa fa-right-from-bracket"></i>
                    <span>Thoat</span>
                </a>
            `}
        `;

        const logoutBtn = document.getElementById('vteenLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                auth.logout();
                window.location.href = resolveUrl('index.html');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', initNavbar);

    window.VTeen = {
        url: resolveUrl,
        escapeHtml,
        slugify,
        getPosterUrl,
        getFallbackPoster,
        normalizeMovieUrl,
        processAndCleanLinks,
        auth,
        github,
        db,
        initNavbar
    };
})(window);
