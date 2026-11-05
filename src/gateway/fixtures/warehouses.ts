import type { RawWarehouse } from '../../domain/warehouse-record.ts';

/**
 * Public Reference Scenarios for the platform warehouse lookup,
 * keyed by warehouseId:
 *
 * - `WH-1`: active, one loading dock (`DOCK-1`) — the route the positive
 *   `DESTINATION_NOT_COVERED` Finding walks.
 * - `WH-2`: inactive — a warehouse-to-dock route that fails closed even
 *   though a dock is on file.
 * - `WH-3`: active, dock `DOCK-2` — feeds a route that breaks one step
 *   later, at dock-to-policy.
 *
 * Any warehouseId not listed here falls back to a synthetic inactive
 * warehouse with no docks in `fixture-commerce-gateway.ts`, matching
 * `getInventory`'s convention of a default rather than a 404 for an
 * unrecognized id.
 */
export const FIXTURE_WAREHOUSES: Record<string, RawWarehouse> = {
  'WH-1': {
    id: 'WH-1',
    active: true,
    dockIds: ['DOCK-1'],
  },
  'WH-2': {
    id: 'WH-2',
    active: false,
    dockIds: ['DOCK-BROKEN-WAREHOUSE'],
  },
  'WH-3': {
    id: 'WH-3',
    active: true,
    dockIds: ['DOCK-2'],
  },
};
