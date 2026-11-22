import { AbsoluteFill } from 'remotion';
import { font } from '../theme';

// Wraps a scene so it always renders in the product font. Without this the
// renderer falls back to a serif, which is exactly what a product surface must
// not look like. Applied at registration so standalone previews match the
// assembled video.
export function withFont<P extends object>(Component: React.ComponentType<P>) {
  const Wrapped: React.FC<P> = (props) => (
    <AbsoluteFill style={{ fontFamily: font.sans }}>
      <Component {...props} />
    </AbsoluteFill>
  );
  Wrapped.displayName = `withFont(${Component.displayName || Component.name || 'Scene'})`;
  return Wrapped;
}
