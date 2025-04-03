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
     * @param _agentId   the agent which owns the parcel (if any)
     * @param _position  the parcel position
     * @param _score     the parcel initial score
     *
     */
    constructor(
        id: string,
        private readonly _agentId: IdAware,
        private readonly _position: Position,
        private readonly _score: DecayingValue,
    ) {
        super(id);
    }

    /**
     * @returns TRUE if the package score is 0 or less
     */
    get expired(): boolean {
        return this._score.getCurrentValue() <= 0;
    }

    /**
     * @returns the score of the parcel at current time
     */
    get currentScore(): number {
        return this._score.getCurrentValue();
    }
}
