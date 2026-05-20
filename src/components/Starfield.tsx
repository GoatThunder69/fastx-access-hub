import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  speed: number;
  twinkleOffset: number;
}

interface Meteor {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  angle: number;
  active: boolean;
  delay: number;
}

const STAR_COUNT = 180;
const METEOR_COUNT = 5;

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

const Starfield = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0;
    let h = 0;

    const stars: Star[] = [];
    const meteors: Meteor[] = [];

    const resize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    };

    const initStars = () => {
      stars.length = 0;
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius: randomBetween(0.3, 1.4),
          alpha: randomBetween(0.3, 1),
          speed: randomBetween(0.0002, 0.001),
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    };

    const initMeteors = () => {
      meteors.length = 0;
      for (let i = 0; i < METEOR_COUNT; i++) {
        meteors.push(makeMeteor(true));
      }
    };

    function makeMeteor(initialDelay = false): Meteor {
      return {
        x: randomBetween(w * 0.1, w * 0.9),
        y: randomBetween(-50, h * 0.3),
        len: randomBetween(80, 180),
        speed: randomBetween(6, 14),
        alpha: 0,
        angle: Math.PI / 4 + randomBetween(-0.15, 0.15), // ~45° ± small variation
        active: false,
        delay: initialDelay ? randomBetween(0, 8000) : randomBetween(4000, 12000),
      };
    }

    let lastTime = 0;
    let meteorTimers: number[] = [];

    const scheduleMeteors = (now: number) => {
      meteors.forEach((m, i) => {
        if (!m.active && meteorTimers[i] === undefined) {
          meteorTimers[i] = window.setTimeout(() => {
            // Reset position before activating
            const fresh = makeMeteor(false);
            Object.assign(m, { ...fresh, active: true, alpha: 1 });
            meteorTimers[i] = undefined as unknown as number;
          }, m.delay);
        }
      });
    };

    const draw = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;

      ctx.clearRect(0, 0, w, h);

      // Stars
      stars.forEach(s => {
        const twinkle = 0.5 + 0.5 * Math.sin(now * s.speed * 1000 + s.twinkleOffset);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.alpha * twinkle})`;
        ctx.fill();
      });

      // Meteors
      meteors.forEach(m => {
        if (!m.active) return;
        const dx = Math.cos(m.angle) * m.len;
        const dy = Math.sin(m.angle) * m.len;
        const grad = ctx.createLinearGradient(m.x, m.y, m.x - dx, m.y - dy);
        grad.addColorStop(0, `rgba(255,255,255,${m.alpha})`);
        grad.addColorStop(0.4, `rgba(180,160,255,${m.alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - dx, m.y - dy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Advance
        m.x += Math.cos(m.angle) * m.speed * (dt / 16);
        m.y += Math.sin(m.angle) * m.speed * (dt / 16);

        // Fade out when nearing edges
        const distEdge = Math.min(m.x, w - m.x, m.y, h - m.y);
        if (distEdge < 120) m.alpha = Math.max(0, m.alpha - 0.03);

        // Deactivate when off screen or invisible
        if (m.x > w + 50 || m.y > h + 50 || m.alpha <= 0) {
          m.active = false;
          m.delay = randomBetween(5000, 15000);
        }
      });

      scheduleMeteors(now);
      animId = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => {
      resize();
      initStars();
    });
    ro.observe(canvas);

    resize();
    initStars();
    initMeteors();
    animId = requestAnimationFrame(t => { lastTime = t; draw(t); });

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      meteorTimers.forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 w-full h-full"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};

export default Starfield;
