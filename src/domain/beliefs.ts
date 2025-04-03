import type { MatchMap } from "@domain/map";
import type { Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import type { PlayerInfo } from "@domain/player-info";

export class BeliefContainer {
    /**
     * The position of the agent owning these beliefs
     * @private
     */
    private _ownPosition: Position;

    constructor(
        info: PlayerInfo,
        private readonly map: MatchMap,
    ) {
        this._ownPosition = info.position;
    }

    synchronizeKnownParcels(parcels: Parcel[]) {
        const a = 1;
    }
}
