import { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import type { Sensor } from "@domain/communication/sensor";
import type { MatchMap } from "@domain/map";
import type { CryptoConfiguration, EnvironmentConfiguration, PddlConfiguration, Parcel } from "@domain/models";
import type { PlayerInfo } from "@domain/player-info";
import { Cipher } from "@utils/cipher";
import { PddlSolver } from "@domain/pddl"
import { Position } from "./models/environment";

export class Player {
    /**
     * TRUE if the player is alive and able to play
     */
    private _isAlive = false;

    /**
     * Cryptographer used to protected messaged exchanged between friends from spies
     */
    private _cipher: Cipher;

    /**
     * Contains all the beliefs of the agent
     */
    private _beliefs: BeliefContainer;

    private _pddlSolver: PddlSolver;

    public constructor(
        matchMap: MatchMap,
        initialParcels: Parcel[],
        private sensor: Sensor,
        private actuator: Actuator,
        private readonly playerInfo: PlayerInfo,
        cryptoConfiguration: CryptoConfiguration,
        private readonly environmentConfiguration: EnvironmentConfiguration,
        private readonly pddlConfiguration: PddlConfiguration,
    ) {
        this._cipher = new Cipher(cryptoConfiguration);
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        this._pddlSolver = new PddlSolver(pddlConfiguration, this._beliefs);

        sensor.onParcelDetected((parcels: Parcel[]) => this.updateKnownParcels(parcels));
        sensor.onPlayerPositionUpdate((position: Position) => this.updatePlayerPosition(position));

    }

    async start(): Promise<void> {
        this._isAlive = true;
        await this._run();
    }

    stop(): void {
        this._isAlive = false;
    }

    /**
     * This method implements the agent loop
     */
    private async _run(): Promise<void> {
        while (this._isAlive) {
            // BDI controll loop

            


            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    updateKnownParcels(parcels: Parcel[]) {
        this._beliefs.synchronizeKnownParcels(parcels);
    }

    updatePlayerPosition(position: Position) {

        // Fix row position
        let new_row: number;
        if (position.row > Math.floor(position.row) && position.row < (Math.floor(position.row) + 0.5)){
            new_row = Math.floor(position.row);
        } else if (position.row > Math.floor(position.row) && position.row > (Math.floor(position.row) + 0.5)) {
            new_row = Math.ceil(position.row);
        } else {
            new_row = position.row;
        }

        // Fix column position
        let new_column: number;
        if (position.column > Math.floor(position.column) && position.column < (Math.floor(position.column) + 0.5)){
            new_column = Math.floor(position.column);
        } else if (position.column > Math.floor(position.column) && position.column > (Math.floor(position.column) + 0.5)) {
            new_column = Math.ceil(position.column);
        } else {
            new_column = position.column;
        }

        // TODO: Check that fix position always works correctly.

        const new_position = new Position(new_row, new_column);

        this.playerInfo.position = new_position;
    }
}

