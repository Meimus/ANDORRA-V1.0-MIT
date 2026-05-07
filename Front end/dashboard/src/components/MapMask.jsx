import { useEffect, useState } from 'react';

// NW → NE → SE → SW (clockwise)
const CORNERS = [
  [42.694543, 1.393847],
  [42.697242, 1.801074],
  [42.396861, 1.803713],
  [42.394176, 1.39849],
];

export default function MapMask({ mapInstance }) {
  const [points, setPoints] = useState(null);

  useEffect(() => {
    const map = mapInstance?.current ?? mapInstance;
    if (!map) return;

    function update() {
      const pts = CORNERS.map(([lat, lon]) => {
        const p = map.latLngToContainerPoint([lat, lon]);
        return `${p.x},${p.y}`;
      });
      setPoints(pts.join(' '));
    }

    map.whenReady(update);
    map.on('resize move zoom', update);
    return () => map.off('resize move zoom', update);
  }, [mapInstance]);

  if (!points) return null;

  return (
    <svg
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 500,
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id="quadMask">
          <rect width="100%" height="100%" fill="white" />
          <polygon points={points} fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="black" mask="url(#quadMask)" />
    </svg>
  );
}
