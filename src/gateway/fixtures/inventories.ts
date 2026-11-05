import type { RawInventory } from '../../domain/inventory-record.ts';

/**
 * Public Reference Scenarios for the platform inventory lookup.
 * `onHand - reserved` is the usable stock represented in the
 * inventory Ledger Fact; no raw fixture payload becomes durable evidence.
 */
export const FIXTURE_INVENTORIES: Record<string, RawInventory> = {
  'SKU-2001': {
    skuId: 'SKU-2001',
    stockLevels: [
      {
        warehouseId: 'WH-1',
        onHand: 12,
        reserved: 0,
        unlimited: false,
      },
    ],
  },
  'SKU-2002': {
    skuId: 'SKU-2002',
    stockLevels: [
      {
        warehouseId: 'WH-1',
        onHand: 8,
        reserved: 0,
        unlimited: false,
      },
    ],
  },
  'SKU-2003': {
    skuId: 'SKU-2003',
    stockLevels: [
      {
        warehouseId: 'WH-1',
        onHand: 0,
        reserved: 0,
        unlimited: false,
      },
    ],
  },
  // Inventory-bearing warehouse is inactive — the warehouse-to-dock route
  // breaks before a shipping policy is ever consulted.
  'SKU-2004': {
    skuId: 'SKU-2004',
    stockLevels: [
      {
        warehouseId: 'WH-2',
        onHand: 8,
        reserved: 0,
        unlimited: false,
      },
    ],
  },
  // Inventory-bearing warehouse and its dock are both active, but the dock's
  // shipping policy does not link back to it — the dock-to-policy route
  // breaks one step later than SKU-2004's.
  'SKU-2005': {
    skuId: 'SKU-2005',
    stockLevels: [
      {
        warehouseId: 'WH-3',
        onHand: 8,
        reserved: 0,
        unlimited: false,
      },
    ],
  },
};
