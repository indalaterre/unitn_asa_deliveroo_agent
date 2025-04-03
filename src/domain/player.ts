import { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import type { Sensor } from "@domain/communication/sensor";
import type { MatchMap } from "@domain/map";
import type { CryptoConfiguration, EnvironmentConfiguration, Parcel } from "@domain/models";
import type { PlayerInfo } from "@domain/player-info";
import { Cipher } from "@utils/cipher";

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

    public constructor(
        matchMap: MatchMap,
        initialParcels: Parcel[],
        cryptoConfiguration: CryptoConfiguration,

        private sensor: Sensor,
        private actuator: Actuator,
        private readonly playerInfo: PlayerInfo,
        private readonly environmentConfiguration: EnvironmentConfiguration,
    ) {
        this._cipher = new Cipher(cryptoConfiguration);
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        sensor.onParcelDetected((parcels: Parcel[]) => this.updateKnownParcels(parcels));
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
            const b = 1;
        }
    }

    updateKnownParcels(parcels: Parcel[]) {
        this._beliefs.synchronizeKnownParcels(parcels);
    }
}
