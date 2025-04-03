import type { Position } from "@domain/models/environment";
import type { IdAware } from "@domain/models/id-aware";

/**
 * Models the player information (id and position)
 */
export class PlayerInfo {
    constructor(
        public readonly id: IdAware,
        public readonly name: string,
        public readonly position: Position,
    ) {}
}
