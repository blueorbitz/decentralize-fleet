import type { CSSProperties, ReactNode } from 'react';

// UI is authored at natural browser sizes so the components stay honest, then
// scaled up to fill a 1920x1080 frame. Without this the windows read as a
// screenshot pasted onto a plate, and 13px type is unreadable in the video.
export default function Stage({
  scale = 1.4,
  children,
  style,
}: {
  scale?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>{children}</div>
    </div>
  );
}
