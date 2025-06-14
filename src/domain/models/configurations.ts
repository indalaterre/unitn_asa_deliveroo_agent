import type { Duration } from "@domain/models/time";

export type EnvironmentConfiguration = {
    readonly parcelRewardMean: number;
    readonly parcelRewardVariance: number;
    readonly parcelGenerationInterval: Duration;
    readonly parcelAvgReward: number;
    readonly parcelDecayingInterval: Duration;
    readonly movementDuration: Duration;
    readonly movementSteps: number;
    readonly parcelVisibilityDistance: number;
    readonly agentVisibilityDistance: number;
    readonly maxParcels: number;
    readonly numRandomAgents: number;
    readonly agentTimeout: Duration;
    readonly randomAgentMovementDuration: Duration;

    //Calculated value
    readonly moveScoreCost: number;
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
     * TRUE if PDDL should be preferred for designed tasks
     */
    usePddl: boolean;

    /**
     * The host for the PDDL planner server
     */
    plannerHost: string;

    /**
     * The total score the agent is allowed to carry at the same time
     */
    maxCarryingParcels: number;

    /**
     * The radius of the area on which calculates the agent density of a tile?
     */
    agentsDensityRadius: number;

    /**
     * Stores the paths for the keys pair used to protect agents communication
     */
    cryptoKeyPaths: CryptoConfiguration;
}

export class GameConfiguration {
    private static _instance?: GameConfiguration;

    private _agentConfiguration: AgentConfiguration;
    private _environmentConfiguration: EnvironmentConfiguration;

    private constructor(
        agentConfiguration: AgentConfiguration,
        envConfiguration: EnvironmentConfiguration,
    ) {
        this._agentConfiguration = agentConfiguration;
        this._environmentConfiguration = envConfiguration;
    }

    static init(
        agentConfiguration: AgentConfiguration,
        envConfiguration: EnvironmentConfiguration,
    ): void {
        if (GameConfiguration._instance) return;
        GameConfiguration._instance = new GameConfiguration(agentConfiguration, envConfiguration);
    }

    static get usePddl(): boolean {
        return GameConfiguration._instance._agentConfiguration.usePddl;
    }

    static get plannerHost(): string {
        return GameConfiguration._instance._agentConfiguration.plannerHost;
    }

    static get movementDuration(): Duration {
        return GameConfiguration._instance._environmentConfiguration.movementDuration;
    }

    static get parcelVisibilityDistance(): number {
        return GameConfiguration._instance._environmentConfiguration.parcelVisibilityDistance;
    }

    static get parcelAvgReward(): number {
        return GameConfiguration._instance._environmentConfiguration.parcelAvgReward;
    }

    static get parcelDecayingInterval(): Duration {
        return GameConfiguration._instance._environmentConfiguration.parcelDecayingInterval;
    }

    static get agentVisibilityDistance(): number {
        return GameConfiguration._instance._environmentConfiguration.agentVisibilityDistance;
    }

    static get moveScoreCost(): number {
        return GameConfiguration._instance._environmentConfiguration.moveScoreCost;
    }

    static get agentsDensityRadius(): number {
        return GameConfiguration._instance._agentConfiguration.agentsDensityRadius;
    }

    static get agentTimeout(): Duration {
        return GameConfiguration._instance._environmentConfiguration.agentTimeout;
    }

    static get maxSpawnableParcels(): number {
        return GameConfiguration._instance._environmentConfiguration.maxParcels;
    }
}
