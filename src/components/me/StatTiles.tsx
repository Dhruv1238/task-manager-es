import type { ComponentProps } from 'react'
import StatTile from './StatTile'

/**
 * One tile's props plus a stable React key. Derived from StatTile itself so the
 * two can never drift apart.
 */
export type StatTileSpec = ComponentProps<typeof StatTile> & { key: string }

/**
 * The tile row at the top of the My Tasks surface. Five tiles, so the grid
 * steps 2 → 3 → 5 rather than reflowing into a ragged last row on tablets.
 */
export default function StatTiles({ tiles }: { tiles: StatTileSpec[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(({ key, ...tile }) => (
        <StatTile key={key} {...tile} />
      ))}
    </div>
  )
}
