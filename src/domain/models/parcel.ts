import type { DecayingValue } from "@domain/models/decaying-value";
import type { Position } from "@domain/models/environment";
import { IdAware } from "@domain/models/id-aware";
/**
 * Models a parcel object
 */
export class Parcel extends IdAware {
    /**
     *
     * @param id        the parcel id
     * @param agentId   the agent which owns the parcel (if any)
     * @param position  the parcel position
     * @param score     the parcel initial score
     *
     */
    constructor(
        public readonly id: string,
        public readonly agentId: IdAware,
        public readonly position: Position,
        public readonly score: DecayingValue,
    ) {
        super(id);
    }

    /**
     * @returns TRUE if the package score is 0 or less
     */
    get expired(): boolean {
        return this.score.currentValue <= 0;
    }

    /**
     * @returns the score of the parcel at current time
     */
    get currentScore(): number {
        return this.score.currentValue;
    }

    /**
     * TRUE if the two parcels are identical
     * @param other the other parcel to compare
     */
    equals(other: Parcel): boolean {
        if (!(other instanceof Parcel)) return false;

        const idEqual = super.equals(other);
        return idEqual && this.position.equals(other.position);
    }
}
