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
    public parcels: Map<string, Parcel>;

    constructor(
        info: PlayerInfo,
        public readonly map: MatchMap,
    ) {
        this._ownPosition = info.position;
        this.parcels = new Map();

        setInterval(() => this._discardExpiredParcels(), 10000);
    }

    synchronizeKnownParcels(parcels: Parcel[]) {
        for (const parcel of parcels){
            this.parcels.set(parcel.id, parcel);
        }
    }

    synchronizeOwnPosition(ownPosition: Position) {
        this._ownPosition = ownPosition;
    }

    private _discardExpiredParcels(){

        let parcelsToRemove: Parcel[] = [];

        for (const [id, parcel] of this.parcels.entries()){
            if (parcel.expired){
                parcelsToRemove.push(parcel);
            }
        }

        for (const parcel of parcelsToRemove){
            this.parcels.delete(parcel.id);
        }

    }
}
