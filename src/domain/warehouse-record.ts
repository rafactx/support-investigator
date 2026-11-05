/**
 * The read-only subset of the commerce platform's warehouse configuration
 * record needed to resolve the loading dock associated with an
 * inventory-bearing warehouse.
 */
export interface RawWarehouse {
  id: string;
  active: boolean;
  dockIds: string[];
}
