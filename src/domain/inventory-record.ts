/**
 * The read-only subset of the commerce platform's SKU inventory record
 * needed to decide whether the requested quantity is usable. The raw
 * provider payload remains inside the inventory capability.
 */
export interface RawInventory {
  skuId: string;
  stockLevels: Array<{
    warehouseId: string;
    onHand: number;
    reserved: number;
    unlimited: boolean;
  }>;
}
