document.addEventListener('DOMContentLoaded', function () {
    const menu = document.getElementById('mainMenu');
    const toggle = document.querySelector('.mobile-menu-toggle');

    if (menu && toggle) {
        toggle.addEventListener('click', function () {
            const open = menu.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            const icon = toggle.querySelector('i');
            if (icon) {
                icon.className = open ? 'fa fa-xmark' : 'fa fa-bars';
            }
        });

        menu.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                menu.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
                const icon = toggle.querySelector('i');
                if (icon) {
                    icon.className = 'fa fa-bars';
                }
            });
        });
    }

    document.body.classList.add('universe-stream-page');

    // Hiệu ứng vũ trụ bây giờ chạy độc lập, không cần footer
    const footer = document.querySelector('.v-footer');

    let stream = document.getElementById('universe-stream');
    if (!stream) {
        stream = document.createElement('div');
        stream.id = 'universe-stream';
        document.body.appendChild(stream);
    }

    if (!stream) {
        return;
    }

    const colors = ['#00f2ff', '#39ffba', '#ffffff', '#7000ff', '#ff00d4'];
    let emitterTimer = null;

    const getSpawnMetrics = function () {
        // Luôn sinh ra từ phía dưới cùng của màn hình (viewport)
        // Không phụ thuộc vào vị trí của footer nữa
        const spawnY = window.innerHeight + 20;
        const travel = window.innerHeight + 120;

        return { spawnY, travel };
    };

    const spawnParticle = function () {
        const metrics = getSpawnMetrics();
        if (!metrics) {
            return;
        }

        const particle = document.createElement('div');
        particle.className = 'stream-particle';

        const size = Math.random() * 3 + 2;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.left = Math.random() * window.innerWidth + 'px';
        particle.style.top = (metrics.spawnY + Math.random() * 18 - 9) + 'px';
        particle.style.color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.setProperty('--duration', (Math.random() * 6 + 8).toFixed(2) + 's');
        particle.style.setProperty('--drift', (Math.random() * 80 - 40).toFixed(2) + 'px');
        particle.style.setProperty('--opacity', (Math.random() * 0.18 + 0.30).toFixed(2));
        particle.style.setProperty('--travel', (-metrics.travel - Math.random() * 80).toFixed(2) + 'px');

        stream.appendChild(particle);

        const ttl = ((parseFloat(particle.style.getPropertyValue('--duration')) || 10) * 1000) + 500;
        window.setTimeout(function () {
            if (particle.parentNode) {
                particle.parentNode.removeChild(particle);
            }
        }, ttl);
    };

    const stopEmitter = function () {
        if (emitterTimer === null) {
            return;
        }

        window.clearInterval(emitterTimer);
        emitterTimer = null;
    };

    const startEmitter = function () {
        if (emitterTimer !== null) {
            return;
        }

        emitterTimer = window.setInterval(function () {
            if (document.hidden) {
                return;
            }
            spawnParticle();
        }, window.innerWidth < 768 ? 180 : 110);
    };

    stream.innerHTML = '';
    for (let i = 0; i < 14; i++) {
        window.setTimeout(spawnParticle, i * 90);
    }

    startEmitter();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            stopEmitter();
            return;
        }

        startEmitter();
    });
});

