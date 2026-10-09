/**
 * VTEEN CORE ENGINE - Git-Native Static & GitHub API Storage
 */
(function (window) {
    'use strict';

    if (window.location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
        window.location.replace('https:' + window.location.href.substring(window.location.protocol.length));
    }

    const FALLBACK_POSTER = 'uploads/posters/poster_1777079252132.jpg';
    const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
    const LOGIN_MAX_ATTEMPTS = 5;
    const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

    const STORAGE_KEYS = {
        SESSION: 'vteen_auth_session_v1',
        LOGIN_GUARD: 'vteen_login_guard_v1',
        GH_CONFIG: 'vteen_github_config_v1',
        GD_CONFIG: 'vteen_gdrive_config_v1',
        GD_QUOTA_CACHE: 'vteen_gdrive_quota_v1',
        MOVIES_CACHE: 'vteen_movies_override_v5',
        IMAGES_CACHE: 'vteen_images_override_v1',
        DRIVE_CACHE: 'vteen_drive_override_v1',
        USERS_CACHE: 'vteen_users_override_v1'
    };

    try {
        ['vteen_movies_override_v1', 'vteen_movies_override_v2', 'vteen_movies_override_v3', 'vteen_movies_override_v4'].forEach(k => localStorage.removeItem(k));
    } catch (e) {}

    function isSubFolder() {
        const path = window.location.pathname.replace(/\\/g, '/');
        return /\/(admin|tube|driver)(\/|$)/.test(path);
    }

    function rootPrefix() {
        return isSubFolder() ? '../' : '';
    }

    function isSafeDataMediaUrl(url) {
        return /^data:(image\/(jpeg|png|gif|webp|bmp|avif)|video\/(mp4|webm|quicktime));base64,[a-z0-9+/=\s]+$/i.test(String(url || '').trim());
    }

    function isSafeHttpUrl(rawUrl) {
        try {
            const parsed = new URL(String(rawUrl || '').trim(), window.location.origin);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch (e) {
            return false;
        }
    }

    function sanitizeDriveId(rawId) {
        const clean = String(rawId || '').trim();
        return /^[a-zA-Z0-9_-]{10,120}$/.test(clean) ? clean : '';
    }

    function resolveUrl(relPath) {
        if (!relPath) return '';
        const clean = String(relPath).trim();
        if (/^(javascript|vbscript):/i.test(clean)) return '';
        if (/^data:/i.test(clean)) return isSafeDataMediaUrl(clean) ? clean : '';
        if (/^(https?:|blob:)/i.test(clean)) return clean;
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

    async function validateUploadFile(file, options = {}) {
        if (!file || typeof file.name !== 'string') {
            return { ok: false, msg: 'Tệp không hợp lệ.' };
        }
        const maxBytes = options.maxBytes || (100 * 1024 * 1024);
        if (file.size <= 0) {
            return { ok: false, msg: 'Tệp rỗng (0 byte).' };
        }
        if (file.size > maxBytes) {
            return { ok: false, msg: `Kích thước tệp vượt quá giới hạn (${Math.round(maxBytes / (1024 * 1024))} MB).` };
        }
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const blockedExt = ['html', 'htm', 'svg', 'xml', 'xhtml', 'js', 'mjs', 'cjs', 'php', 'phtml', 'exe', 'dll', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'scr', 'msi', 'jar'];
        if (blockedExt.includes(ext)) {
            return { ok: false, msg: `Định dạng .${ext} bị chặn vì lý do bảo mật.` };
        }
        const allowedExt = options.allowedExt || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'pdf', 'zip', 'rar', '7z', 'txt'];
        if (!allowedExt.includes(ext)) {
            return { ok: false, msg: `Định dạng .${ext} không nằm trong danh sách hỗ trợ.` };
        }

        // Check magic bytes for image files to block disguised HTML/script payloads
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) && file.slice) {
            try {
                const headerBuf = await file.slice(0, 16).arrayBuffer();
                const b = new Uint8Array(headerBuf);
                const isJpeg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
                const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
                const isGif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
                const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
                if (!isJpeg && !isPng && !isGif && !isWebp) {
                    return { ok: false, msg: 'Nội dung tệp ảnh không khớp với chữ ký nhị phân (Magic Bytes).' };
                }
            } catch (e) {}
        }
        return { ok: true, ext };
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
        return resolveUrl(p) || resolveUrl(FALLBACK_POSTER);
    }

    function getFallbackPoster() {
        return resolveUrl(FALLBACK_POSTER);
    }

    function normalizeMovieUrl(rawUrl) {
        let link = String(rawUrl || '').trim();
        if (!link || /^(javascript|vbscript|data):/i.test(link)) return '';
        const clbMatch = link.match(/clbphimxua\.com\/clbpx\.html\?v=([A-Za-z0-9_-]+)/i);
        if (clbMatch) return `https://abysscdn.com/?v=${clbMatch[1]}`;
        const shortMatch = link.match(/short\.icu\/([A-Za-z0-9_-]+)/i);
        if (shortMatch) return `https://abysscdn.com/?v=${shortMatch[1]}`;
        const driveMatch = link.match(/drive\.google\.com\/.*?\/d\/([a-zA-Z0-9_-]+)/i);
        if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
        const dmMatch = link.match(/(?:dailymotion\.com\/video|dai\.ly)\/([a-z0-9]+)/i);
        if (dmMatch) return `https://www.dailymotion.com/embed/video/${dmMatch[1]}?autoplay=1`;
        return isSafeHttpUrl(link) ? link : '';
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
            const normalized = normalizeMovieUrl(link);
            if (normalized) clean.push(normalized);
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
                if (data && data.username) {
                    if (!data.time || (Date.now() - Number(data.time)) > SESSION_TTL_MS) {
                        localStorage.removeItem(STORAGE_KEYS.SESSION);
                        return null;
                    }
                    return data;
                }
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
        getLoginGuard() {
            try {
                return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGIN_GUARD) || '{"fails":0,"lockUntil":0}');
            } catch (e) {
                return { fails: 0, lockUntil: 0 };
            }
        },
        recordLoginFail() {
            const g = this.getLoginGuard();
            g.fails = (Number(g.fails) || 0) + 1;
            if (g.fails >= LOGIN_MAX_ATTEMPTS) {
                g.lockUntil = Date.now() + LOGIN_LOCKOUT_MS;
                g.fails = 0;
            }
            try {
                localStorage.setItem(STORAGE_KEYS.LOGIN_GUARD, JSON.stringify(g));
            } catch (e) {}
            return g;
        },
        clearLoginGuard() {
            try {
                localStorage.removeItem(STORAGE_KEYS.LOGIN_GUARD);
            } catch (e) {}
        },
        async loadBcrypt() {
            if (window.dcodeIO && window.dcodeIO.bcrypt) return window.dcodeIO.bcrypt;
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js';
                s.crossOrigin = 'anonymous';
                s.onload = () => resolve(window.dcodeIO && window.dcodeIO.bcrypt);
                s.onerror = () => reject(new Error('Không thể tải thư viện xác thực bcryptjs'));
                document.head.appendChild(s);
            });
        },
        async verifyLogin(username, password, requireAdmin = false) {
            const guard = this.getLoginGuard();
            if (guard.lockUntil && Date.now() < guard.lockUntil) {
                const remainSec = Math.ceil((guard.lockUntil - Date.now()) / 1000);
                return { ok: false, msg: `Nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainSec} giây.` };
            }

            const users = await db.getUsers();
            const user = users.find(u => String(u.username).toLowerCase() === String(username).trim().toLowerCase());
            if (!user) {
                this.recordLoginFail();
                return { ok: false, msg: 'Sai tài khoản hoặc mật khẩu.' };
            }
            if (requireAdmin && user.role !== 'admin') {
                this.recordLoginFail();
                return { ok: false, msg: 'Tài khoản này không có quyền Quản trị viên!' };
            }
            const bcrypt = await this.loadBcrypt();
            const normalizedHash = String(user.password || '').replace(/^\$2y\$/, '$2a$');
            const matched = bcrypt.compareSync(String(password), normalizedHash);
            if (!matched) {
                this.recordLoginFail();
                return { ok: false, msg: 'Sai tài khoản hoặc mật khẩu.' };
            }
            this.clearLoginGuard();
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

    // --- GOOGLE DRIVE 15GB LIVE INTEGRATION (Apps Script Bridge + OAuth2 API v3) ---
    let memoryDriveConfig = null;
    let cachedOAuthToken = { token: '', expiresAt: 0 };

    const gdrive = {
        getConfig() {
            let local = {};
            try {
                local = JSON.parse(localStorage.getItem(STORAGE_KEYS.GD_CONFIG) || '{}');
            } catch (e) {}
            const base = memoryDriveConfig || {};
            return {
                scriptUrl: String(local.scriptUrl || base.scriptUrl || '').trim(),
                folderId: String(local.folderId || base.folderId || '').trim(),
                clientId: String(local.clientId || '').trim(),
                clientSecret: String(local.clientSecret || '').trim(),
                refreshToken: String(local.refreshToken || '').trim(),
                accountKey: String(local.accountKey || base.accountKey || 'drive1').trim() || 'drive1'
            };
        },
        async loadRemoteConfig() {
            if (!memoryDriveConfig) {
                memoryDriveConfig = await fetchJson('data/drive_config.json', {});
            }
            return this.getConfig();
        },
        async saveConfig(cfg) {
            const clean = {
                scriptUrl: String(cfg.scriptUrl || '').trim(),
                folderId: String(cfg.folderId || '').trim(),
                clientId: String(cfg.clientId || '').trim(),
                clientSecret: String(cfg.clientSecret || '').trim(),
                refreshToken: String(cfg.refreshToken || '').trim(),
                accountKey: String(cfg.accountKey || 'drive1').trim() || 'drive1'
            };
            localStorage.setItem(STORAGE_KEYS.GD_CONFIG, JSON.stringify(clean));
            localStorage.removeItem(STORAGE_KEYS.GD_QUOTA_CACHE);
            cachedOAuthToken = { token: '', expiresAt: 0 };
            memoryDriveConfig = {
                scriptUrl: clean.scriptUrl,
                folderId: clean.folderId,
                accountKey: clean.accountKey
            };
            if (github.isConfigured()) {
                try {
                    await github.saveJsonFile('data/drive_config.json', memoryDriveConfig, 'Update Google Drive bridge config');
                } catch (e) {}
            }
            return clean;
        },
        isConfigured() {
            const c = this.getConfig();
            const hasScript = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec/i.test(c.scriptUrl);
            const hasOAuth = !!(c.clientId && c.clientSecret && c.refreshToken);
            return hasScript || hasOAuth;
        },
        getMode() {
            const c = this.getConfig();
            if (/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec/i.test(c.scriptUrl)) return 'apps_script';
            if (c.clientId && c.clientSecret && c.refreshToken) return 'oauth';
            return 'none';
        },
        async getOAuthAccessToken() {
            if (cachedOAuthToken.token && Date.now() < cachedOAuthToken.expiresAt) {
                return cachedOAuthToken.token;
            }
            const c = this.getConfig();
            if (!c.clientId || !c.clientSecret || !c.refreshToken) {
                throw new Error('Chưa cấu hình Google OAuth2 (Client ID / Secret / Refresh Token).');
            }
            const body = new URLSearchParams({
                client_id: c.clientId,
                client_secret: c.clientSecret,
                refresh_token: c.refreshToken,
                grant_type: 'refresh_token'
            });
            const res = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.access_token) {
                throw new Error(data.error_description || data.error || `OAuth HTTP ${res.status}`);
            }
            cachedOAuthToken = {
                token: data.access_token,
                expiresAt: Date.now() + ((Number(data.expires_in) || 3500) - 60) * 1000
            };
            return cachedOAuthToken.token;
        },
        async getQuota(forceRefresh = false) {
            await this.loadRemoteConfig();
            if (!this.isConfigured()) return null;

            if (!forceRefresh) {
                try {
                    const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.GD_QUOTA_CACHE) || 'null');
                    if (cached && cached.savedAt && (Date.now() - cached.savedAt) < 120000) {
                        return cached;
                    }
                } catch (e) {}
            }

            const mode = this.getMode();
            const c = this.getConfig();
            let usage = 0;
            let limit = 15 * 1024 * 1024 * 1024;

            if (mode === 'apps_script') {
                const sep = c.scriptUrl.includes('?') ? '&' : '?';
                const res = await fetch(`${c.scriptUrl}${sep}action=quota&t=${Date.now()}`, { cache: 'no-store' });
                const data = await res.json();
                if (data.status !== 'success') {
                    throw new Error(data.message || 'Không lấy được dung lượng từ Google Apps Script');
                }
                usage = Number(data.usage) || 0;
                limit = Number(data.limit) || limit;
            } else if (mode === 'oauth') {
                const token = await this.getOAuthAccessToken();
                const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (!res.ok || !data.storageQuota) {
                    throw new Error((data.error && data.error.message) || 'Không lấy được storageQuota từ Google Drive');
                }
                usage = Number(data.storageQuota.usage) || 0;
                limit = Number(data.storageQuota.limit) || limit;
            }

            const quotaObj = {
                usage,
                limit,
                percent: limit > 0 ? Math.min(100, Number(((usage / limit) * 100).toFixed(2))) : 0,
                savedAt: Date.now()
            };
            try {
                localStorage.setItem(STORAGE_KEYS.GD_QUOTA_CACHE, JSON.stringify(quotaObj));
            } catch (e) {}
            return quotaObj;
        },
        async syncLiveFiles(existingFiles = []) {
            await this.loadRemoteConfig();
            if (!this.isConfigured()) return { files: existingFiles, quota: null };
            const mode = this.getMode();
            const c = this.getConfig();
            let remoteList = [];
            let quotaObj = null;

            if (mode === 'apps_script') {
                const sep = c.scriptUrl.includes('?') ? '&' : '?';
                const res = await fetch(`${c.scriptUrl}${sep}action=list&t=${Date.now()}`, { cache: 'no-store' });
                const data = await res.json();
                if (data.status === 'success') {
                    const usage = Number(data.usage) || 0;
                    const limit = Number(data.limit) || (15 * 1024 * 1024 * 1024);
                    quotaObj = {
                        usage,
                        limit,
                        percent: limit > 0 ? Math.min(100, Number(((usage / limit) * 100).toFixed(2))) : 0,
                        savedAt: Date.now()
                    };
                    try {
                        localStorage.setItem(STORAGE_KEYS.GD_QUOTA_CACHE, JSON.stringify(quotaObj));
                    } catch (e) {}
                    remoteList = Array.isArray(data.files) ? data.files : [];
                }
            } else if (mode === 'oauth') {
                const token = await this.getOAuthAccessToken();
                quotaObj = await this.getQuota(true).catch(() => null);
                const q = c.folderId
                    ? `'${c.folderId.replace(/'/g, '')}' in parents and trashed = false`
                    : `trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=100&fields=files(id,name,mimeType,size,createdTime)`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && Array.isArray(data.files)) {
                    remoteList = data.files.map(f => ({
                        drive_id: f.id,
                        file_name: f.name,
                        mime_type: f.mimeType,
                        file_size: Number(f.size) || 0,
                        created_at: (f.createdTime || '').slice(0, 19).replace('T', ' ')
                    }));
                }
            }

            if (!remoteList.length) {
                return { files: existingFiles, quota: quotaObj };
            }

            const byDriveId = new Map();
            existingFiles.forEach(item => {
                if (item.drive_id) byDriveId.set(String(item.drive_id), item);
            });

            let added = false;
            const merged = [...existingFiles];
            for (const rf of remoteList) {
                const cleanId = sanitizeDriveId(rf.drive_id);
                if (!cleanId) continue;
                const existing = byDriveId.get(cleanId);
                if (existing) {
                    if (!existing.file_size && rf.file_size) existing.file_size = Number(rf.file_size);
                    if ((!existing.file_name || existing.file_name.startsWith('Drive_')) && rf.file_name) {
                        existing.file_name = rf.file_name;
                    }
                } else {
                    added = true;
                    merged.unshift({
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        short_code: cleanId.slice(0, 12).toLowerCase(),
                        drive_id: cleanId,
                        account_key: c.accountKey || 'drive1',
                        file_name: rf.file_name || `Drive_${cleanId.slice(0, 8)}`,
                        file_path: '',
                        mime_type: rf.mime_type || 'application/octet-stream',
                        file_size: Number(rf.file_size) || 0,
                        created_at: rf.created_at || new Date().toISOString().slice(0, 19).replace('T', ' ')
                    });
                }
            }

            if (added) {
                await db.saveDriveFiles(merged, 'Sync Google Drive files');
            }
            return { files: merged, quota: quotaObj };
        },
        async uploadFile(file, customName = '') {
            await this.loadRemoteConfig();
            if (!this.isConfigured()) {
                throw new Error('Chưa kết nối Google Drive.');
            }
            const fileName = (customName || file.name || `vteen_${Date.now()}`).trim();
            const mimeType = file.type || 'application/octet-stream';
            const mode = this.getMode();
            const c = this.getConfig();

            if (mode === 'apps_script') {
                const buffer = await file.arrayBuffer();
                const b64 = github.arrayBufferToBase64(buffer);
                const res = await fetch(c.scriptUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'upload',
                        fileName,
                        mimeType,
                        base64: b64
                    })
                });
                const data = await res.json();
                if (data.status !== 'success' || !data.file || !data.file.drive_id) {
                    throw new Error(data.message || 'Tải tệp lên Google Drive thất bại.');
                }
                if (data.quota) {
                    const limit = Number(data.quota.limit) || (15 * 1024 * 1024 * 1024);
                    const usage = Number(data.quota.usage) || 0;
                    try {
                        localStorage.setItem(STORAGE_KEYS.GD_QUOTA_CACHE, JSON.stringify({
                            usage,
                            limit,
                            percent: Math.min(100, Number(((usage / limit) * 100).toFixed(2))),
                            savedAt: Date.now()
                        }));
                    } catch (e) {}
                }
                return {
                    drive_id: sanitizeDriveId(data.file.drive_id),
                    file_name: data.file.file_name || fileName,
                    mime_type: data.file.mime_type || mimeType,
                    file_size: Number(data.file.file_size) || file.size,
                    created_at: data.file.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
                    account_key: c.accountKey || 'drive1'
                };
            }

            if (mode === 'oauth') {
                const token = await this.getOAuthAccessToken();
                const metadata = { name: fileName, mimeType };
                if (c.folderId) metadata.parents = [c.folderId];

                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', file);

                const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: form
                });
                const data = await res.json();
                if (!res.ok || !data.id) {
                    throw new Error((data.error && data.error.message) || 'Google Drive API upload failed');
                }

                // Make file viewable via link
                await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(data.id)}/permissions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ role: 'reader', type: 'anyone' })
                }).catch(() => {});

                localStorage.removeItem(STORAGE_KEYS.GD_QUOTA_CACHE);
                return {
                    drive_id: sanitizeDriveId(data.id),
                    file_name: data.name || fileName,
                    mime_type: data.mimeType || mimeType,
                    file_size: Number(data.size) || file.size,
                    created_at: (data.createdTime || new Date().toISOString()).slice(0, 19).replace('T', ' '),
                    account_key: c.accountKey || 'drive1'
                };
            }

            throw new Error('Chế độ Google Drive không hợp lệ.');
        },
        async deleteFile(driveId) {
            const cleanId = sanitizeDriveId(driveId);
            if (!cleanId || !this.isConfigured()) return false;
            const mode = this.getMode();
            const c = this.getConfig();
            try {
                if (mode === 'apps_script') {
                    await fetch(c.scriptUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: 'delete', driveId: cleanId })
                    });
                    localStorage.removeItem(STORAGE_KEYS.GD_QUOTA_CACHE);
                    return true;
                }
                if (mode === 'oauth') {
                    const token = await this.getOAuthAccessToken();
                    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    localStorage.removeItem(STORAGE_KEYS.GD_QUOTA_CACHE);
                    return true;
                }
            } catch (e) {}
            return false;
        },
        getAppsScriptTemplate() {
            return [
                "const FOLDER_NAME = 'VTEEN_DRIVE';",
                "function getOrCreateFolder() {",
                "  const f = DriveApp.getFoldersByName(FOLDER_NAME);",
                "  if (f.hasNext()) return f.next();",
                "  const created = DriveApp.createFolder(FOLDER_NAME);",
                "  created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);",
                "  return created;",
                "}",
                "function jsonOut(obj) {",
                "  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);",
                "}",
                "function doGet(e) {",
                "  try {",
                "    const action = (e && e.parameter && e.parameter.action) || 'quota';",
                "    const usage = DriveApp.getStorageUsed();",
                "    const limit = DriveApp.getStorageLimit() || (15 * 1024 * 1024 * 1024);",
                "    const folder = getOrCreateFolder();",
                "    if (action === 'list') {",
                "      const files = [], iter = folder.getFiles();",
                "      while (iter.hasNext() && files.length < 200) {",
                "        const file = iter.next();",
                "        files.push({ drive_id: file.getId(), file_name: file.getName(), mime_type: file.getMimeType(), file_size: file.getSize(), created_at: Utilities.formatDate(file.getDateCreated(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss') });",
                "      }",
                "      return jsonOut({ status: 'success', usage, limit, folderId: folder.getId(), files });",
                "    }",
                "    return jsonOut({ status: 'success', usage, limit, folderId: folder.getId() });",
                "  } catch (err) { return jsonOut({ status: 'error', message: String(err) }); }",
                "}",
                "function doPost(e) {",
                "  try {",
                "    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');",
                "    if (body.action === 'delete' && body.driveId) {",
                "      DriveApp.getFileById(body.driveId).setTrashed(true);",
                "      return jsonOut({ status: 'success' });",
                "    }",
                "    const folder = getOrCreateFolder();",
                "    const name = String(body.fileName || ('vteen_' + Date.now())).replace(/[\\\\/:*?\"<>|]/g, '_');",
                "    const mime = String(body.mimeType || 'application/octet-stream');",
                "    const blob = Utilities.newBlob(Utilities.base64Decode(String(body.base64 || '')), mime, name);",
                "    const file = folder.createFile(blob);",
                "    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);",
                "    return jsonOut({",
                "      status: 'success',",
                "      file: { drive_id: file.getId(), file_name: file.getName(), mime_type: file.getMimeType(), file_size: file.getSize(), created_at: Utilities.formatDate(file.getDateCreated(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss') },",
                "      quota: { usage: DriveApp.getStorageUsed(), limit: DriveApp.getStorageLimit() || (15 * 1024 * 1024 * 1024) }",
                "    });",
                "  } catch (err) { return jsonOut({ status: 'error', message: String(err) }); }",
                "}"
            ].join('\n');
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
        isSafeHttpUrl,
        sanitizeDriveId,
        validateUploadFile,
        slugify,
        getPosterUrl,
        getFallbackPoster,
        normalizeMovieUrl,
        processAndCleanLinks,
        auth,
        github,
        gdrive,
        db,
        initNavbar
    };
})(window);

