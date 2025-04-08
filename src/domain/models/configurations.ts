import type { Duration } from "@domain/models/time";

export type EnvironmentConfiguration = {
    readonly parcelRewardMean: number;
    readonly parcelRewardVariance: number;
    readonly parcelGenerationInterval: Duration;
    readonly parcelDecayingInterval: Duration;
    readonly movementDuration: Duration;
    readonly movementSteps: number;
    readonly parcelVisibilityDistance: number;
    readonly agentVisibilityDistance: number;
    readonly maxParcels: number;
    readonly numRandomAgents: number;
    readonly randomAgentMovementDuration: Duration;
};

export interface CryptoConfiguration {
    /**
     * The path to the private key
     */
    privatePath: string;

    /**
     * The path to the private key
     */
    publicPath: string;
}

export interface PddlConfiguration {
    /**
     * The host to the pddl server.
     */
    host: string;

    /**
     *
     */
    pass_path: string;
}

export interface AgentConfiguration {
    /**
     * The Deliveroo.js host
     */
    host: string;

    /**
     * Authentication token for deliveroo.js api
     */
    token: string;

    /**
     * Stores the paths for the keys pair used to protect agents communication
     */
    cryptoKeyPaths: CryptoConfiguration;

    /**
     * Stores the host and pass path to query the pddl online server
     */
    pddlConfiguration: PddlConfiguration;
}

export class GameConfiguration {
    private static _instance?: GameConfiguration;

    private _environmentConfiguration: EnvironmentConfiguration;

    private constructor(envConfiguration: EnvironmentConfiguration) {
        this._environmentConfiguration = envConfiguration;
    }

    static init(envConfiguration: EnvironmentConfiguration): void {
        if (GameConfiguration._instance) return;
        GameConfiguration._instance = new GameConfiguration(envConfiguration);
    }

    static get movementDuration(): Duration {
        return GameConfiguration._instance._environmentConfiguration.movementDuration;
    }

    static get parcelVisibilityDistance(): number {
        return GameConfiguration._instance._environmentConfiguration.parcelVisibilityDistance;
    }
}
