import { useState, useEffect } from 'react';
import { supabase, type Broadcast } from '@/lib/supabase';
import { Bell, X, Megaphone } from 'lucide-react';

interface AlertBannerProps {
  panelId: string;
}

const AlertBanner = ({ panelId }: AlertBannerProps) => {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();

    const fetchBroadcasts = async () => {
      // Abort any prior in-flight request before starting a new one.
      controller.abort();
      controller = new AbortController();
      try {
        const { data } = await supabase.rpc('get_latest_broadcast', { p_panel_id: panelId });
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setBroadcasts(row ? [row as Broadcast] : []);
      } catch {
        // Ignore network errors; next poll will retry.
      }
    };

    fetchBroadcasts();
    const intervalId = window.setInterval(fetchBroadcasts, 30_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [panelId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`cfms_dismissed_${panelId}`);
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch {
      // Corrupted localStorage — start fresh
      localStorage.removeItem(`cfms_dismissed_${panelId}`);
    }
  }, [panelId]);

  const dismiss = (id: string) => {
    const newDismissed = new Set(dismissed);
    newDismissed.add(id);
    setDismissed(newDismissed);
    localStorage.setItem(`cfms_dismissed_${panelId}`, JSON.stringify([...newDismissed]));
  };

  const visible = broadcasts.filter(b => !dismissed.has(b.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-0">
      {visible.map((b, i) => (
        <div
          key={b.id}
          className="flex items-center gap-3 px-4 py-3 text-sm border-b border-primary/10 animate-in"
          style={{
            background: i === 0
              ? 'linear-gradient(90deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.04))'
              : 'linear-gradient(90deg, hsl(var(--primary) / 0.06), transparent)',
          }}
        >
          <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold text-primary text-xs tracking-wide">{b.title}</span>
            <span className="mx-2 text-muted-foreground/30">•</span>
            <span className="text-foreground/70 text-xs">{b.message}</span>
          </div>
          <button
            onClick={() => dismiss(b.id)}
            className="p-1.5 hover:bg-secondary/50 rounded-lg transition-colors flex-shrink-0 group"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AlertBanner;
