import { type Socket, io } from "socket.io-client";

import type { Actuator } from "@domain/communication/actuator";
import { Directions, Position, Tile, TileType } from "@domain/models/environment";

import { Cipher } from "@domain/communication/cipher";
import type { Information } from "@domain/communication/information";
import type { Sensor } from "@domain/communication/sensor";
import { Duration, type EnvironmentConfiguration, Parcel } from "@domain/models";
import { Agent } from "@domain/models/agent";
import type { CryptoConfiguration } from "@domain/models/configurations";
import { DecayingValue } from "@domain/models/decaying-value";
import { IdAware } from "@domain/models/id-aware";
import type { IntentionTypes } from "@domain/models/intention";
import { PlayerInfo } from "@domain/player-info";
import type {
    AgentPositionUpdate,
    HelloMessage,
    Message,
    Messenger,
    ParcelInfoMessage,
} from "./messenger";

export class SocketClient implements Actuator, Information, Sensor, Messenger {
    private readonly _socket: Socket;
    private readonly _cipher: Cipher;

    private _myAgentId: string;

    constructor(deliverooHost: string, token: string, cryptoConfiguration: CryptoConfiguration) {
        this._socket = io(deliverooHost, {
            autoConnect: true,
            extraHeaders: { "x-token": token },
        });

        this._cipher = new Cipher(cryptoConfiguration);
    }

    shoutIntention(
        intentionType: IntentionTypes,
        targetPosition: Position,
        currentPosition: Position,
        priority?: number,
    ): Promise<void> {
        throw new Error("Method not implemented.");
    }
    shoutHelpRequest(
        requestType: "pickup" | "delivery",
        position: Position,
        parcelIds?: string[],
        urgency?: number,
        expiresIn?: number,
    ): Promise<string> {
        throw new Error("Method not implemented.");
    }
    sendHelpResponse(
        targetAgentId: string,
        requestId: string,
        accepted: boolean,
        estimatedTimeToArrive?: number,
    ): Promise<void> {
        throw new Error("Method not implemented.");
    }
    sendCoordinationMessage(
        action: string,
        position: Position,
        details?: any,
        targetAgentId?: string,
    ): Promise<void> {
        throw new Error("Method not implemented.");
    }
    sendHandoffRequest(
        targetAgentId: string,
        parcelIds: string[],
        meetingPosition: Position,
        urgency: number,
        timeToMeet: number,
        expiresIn?: number,
    ): Promise<string> {
        throw new Error("Method not implemented.");
    }
    sendHandoffResponse(
        targetAgentId: string,
        requestId: string,
        accepted: boolean,
        parcelIds: string[],
        meetingPosition: Position,
        estimatedArrivalTime: number,
    ): Promise<void> {
        throw new Error("Method not implemented.");
    }
    sendHandoffConfirm(
        targetAgentId: string,
        requestId: string,
        parcelIds: string[],
        success: boolean,
        position: Position,
    ): Promise<void> {
        throw new Error("Method not implemented.");
    }

    move(direction: Directions): Promise<boolean> {
        if (direction === Directions.NONE) {
            return Promise.resolve(true);
        }

        return new Promise((resolve, _reject) => {
            this._socket.emit("move", direction, (response: boolean | PromiseLike<boolean>) =>
                resolve(response),
            );
        });
    }

    detectParcels(): Promise<Parcel[]> {
        return new Promise((resolve, _reject) => {
            this.onParcelDetected(resolve);
        });
    }

    /**
     * Before the execution of the callback, translates the parcel data into a model for our agent
     * The read message has the following format:
     * {
     *     id        => the parcel id
     *     reward    => the current parcel score
     *     x         => the row position
     *     y         => the column position
     *     carriedBy => if not null contains the id of the agent which is carrying it
     * }
     *
     */
    onParcelDetected(callback: (parcels: Parcel[]) => void): void {
        this._socket.on("parcels sensing", (detectedParcels: any) => {
            if (!detectedParcels?.length) {
                callback([]);
            }

            const parcels: Parcel[] = detectedParcels.map((parcel: any) => {
                return new Parcel(
                    parcel.id,
                    parcel.carriedBy ? new IdAware(parcel.carriedBy) : null,
                    new Position(parcel.x, parcel.y),
                    new DecayingValue(parcel.reward),
                );
            });

            callback(parcels);
        });
    }

    /**
     * Before the execution of the callback, translates the agent data into a model for our agent
     * The read message has the following format:
     * {
     *     id        => the parcel id
     *     x         => the row position
     *     y         => the column position
     *     score    => the current agent score
     * }
     *
     */
    onAgentSensing(callback: (agents: Agent[]) => void): void {
        this._socket.on("agents sensing", (agents: any[]) => {
            const newAgents: Agent[] = agents.map(
                (agentData: any) =>
                    new Agent(
                        agentData.id,
                        new Position(agentData.x, agentData.y),
                        agentData.score,
                    ),
            );

            newAgents.length && callback(newAgents);
        });
    }

    onPlayerPositionUpdate(callback: (position: Position) => void): void {
        this._socket.on("you", (player) => {
            callback(new Position(player.x, player.y));
        });
    }

    loadConfiguration(): Promise<EnvironmentConfiguration> {
        return new Promise((resolve: (arg0: EnvironmentConfiguration) => void) => {
            this._socket.once("config", (config: any) => {
                const parsedConfig = {
                    maxParcels: SocketClient.parseNumericConfiguration(config, "PARCELS_MAX"),
                    parcelRewardMean: SocketClient.parseNumericConfiguration(
                        config,
                        "PARCEL_REWARD_AVG",
                    ),
                    movementDuration: SocketClient.parseMillisecondsDurationConfiguration(
                        config,
                        "MOVEMENT_DURATION",
                    ),
                    agentVisibilityDistance: SocketClient.parseNumericConfiguration(
                        config,
                        "AGENTS_OBSERVATION_DISTANCE",
                    ),
                    parcelVisibilityDistance: SocketClient.parseNumericConfiguration(
                        config,
                        "PARCELS_OBSERVATION_DISTANCE",
                    ),
                    parcelDecayingInterval: SocketClient.parseSecondsDurationConfiguration(
                        config,
                        "PARCEL_DECADING_INTERVAL",
                    ),
                } as EnvironmentConfiguration;

                const moveScoreCost: number = parsedConfig.parcelDecayingInterval.isInfinite
                    ? 0
                    : parsedConfig.movementDuration.seconds /
                      parsedConfig.parcelDecayingInterval.seconds;

                resolve({ ...parsedConfig, moveScoreCost });
            });
        });
    }

    getEnvironment(): Promise<EnvironmentConfiguration> {
        return Promise.resolve(undefined);
    }

    getFreeTiles(): Promise<Tile[]> {
        return new Promise((resolve: (arg0: Tile[]) => void) => {
            this._socket.once("map", (_: number, __: number, tilesData: any[]) => {
                const tiles: Tile[] = tilesData.map((tile) => {
                    return new Tile(
                        tile.parcelSpawner ?? tile.type === TileType.SPAWN,
                        tile.delivery ?? tile.type === TileType.DELIVERY,
                        tile.type !== TileType.NON_WALKABLE,
                        new Position(tile.x, tile.y),
                    );
                });
                resolve(tiles);
            });
        });
    }

    getPlayerInfo(): Promise<PlayerInfo> {
        return new Promise((resolve: (arg0: PlayerInfo) => void) => {
            this._socket.once("you", (data: any) => {
                const info = new PlayerInfo(
                    new IdAware(data.id),
                    data.name,
                    new Position(data.x, data.y),
                );

                this._myAgentId = data.id;
                resolve(info);
            });
        });
    }

    private static parseNumericConfiguration(config: any, key: string): number {
        switch (typeof config[key]) {
            case "string":
                if (config[key] === "infinite") {
                    return Number.POSITIVE_INFINITY;
                }
                return Number.parseInt(config[key], 10);
            case "number":
                return config[key];
            default: {
                throw new Error(`Invalid key: ${key}`);
            }
        }
    }

    private static parseMillisecondsDurationConfiguration(config: any, key: string): Duration {
        switch (typeof config[key]) {
            case "string": {
                const interval: number =
                    config[key] === "infinite"
                        ? Number.POSITIVE_INFINITY
                        : Number.parseInt(config[key].slice(0, -1), 10);
                return Duration.fromMilliseconds(interval, config[key] === "infinite");
            }
            case "number":
                return Duration.fromMilliseconds(config[key]);
            default:
                throw new Error(`Invalid key: ${key}`);
        }
    }

    private static parseSecondsDurationConfiguration(config: any, key: string): Duration {
        switch (typeof config[key]) {
            case "string": {
                const interval: number =
                    config[key] === "infinite"
                        ? Number.POSITIVE_INFINITY
                        : Number.parseInt(config[key].slice(0, -1), 10) * 1000;
                return Duration.fromMilliseconds(interval, config[key] === "infinite");
            }
            case "number":
                return Duration.fromMilliseconds(config[key] * 1000);
            default:
                throw new Error(`Invalid key: ${key}`);
        }
    }

    pickup(): Promise<Set<string>> {
        return new Promise((resolve, _reject) => {
            this._socket.emit("pickup", (response: any[]) => {
                const parcels: Set<string> = new Set<string>();
                for (const parcel of response) {
                    parcels.add(parcel.id);
                }

                resolve(parcels);
            });
        });
    }

    putDown(parcelsToPutDown: string[] | null): Promise<Set<string>> {
        return new Promise((resolve, _reject) => {
            this._socket.emit("putdown", parcelsToPutDown, (response: any[]) => {
                const putDownParcels: Set<string> = new Set<string>();
                for (const parcel of response) {
                    putDownParcels.add(parcel.id);
                }

                resolve(putDownParcels);
            });
        });
    }

    // MESSENGER METHODS

    shoutHelloMessage(message: HelloMessage): Promise<void> {
        return this.shoutMessage(message);
    }

    replyHelloMessage(message: HelloMessage): Promise<void> {
        return this.sendMessage(message);
    }

    onHelloMessageReceived(callback: (agent: Agent) => void): void {
        this.onMessageReceived((message: HelloMessage) => {
            const agentPosition = new Position(message.position.row, message.position.column);
            const agent = new Agent(message.senderId, agentPosition, message.score);

            callback(agent);
        });
    }

    shoutParcelInfo(message: ParcelInfoMessage): Promise<void> {
        return this.sendMessage(message);
    }

    onParcelInfoReceived(callback: (parcels: Parcel[]) => void): void {
        this.onMessageReceived((message: ParcelInfoMessage) => {
            const parsedParcels: Parcel[] = message.parcels.map((parcel) => {
                return new Parcel(
                    parcel.id,
                    new IdAware(parcel.agentId),
                    new Position(parcel.position.row, parcel.position.column),
                    new DecayingValue(parcel.score),
                );
            });

            callback(parsedParcels);
        });
    }

    shoutAgentsInfo(message: AgentPositionUpdate): Promise<void> {
        return this.shoutMessage(message);
    }

    onAgentsInfoReceived(callback: (agents: Agent[]) => void): void {
        this.onMessageReceived((message: AgentPositionUpdate) => {
            const parsedAgents: Agent[] = message.agents.map((agent) => {
                const agentPosition = new Position(agent.position.row, agent.position.column);
                return new Agent(agent.agentId, agentPosition, agent.score);
            });

            callback(parsedAgents);
        });
    }

    private shoutMessage(message: Message): Promise<void> {
        return new Promise((resolve, _reject) => {
            const encrypted: string = this._cipher.encryptObject(message);
            this._socket.emit("shout", encrypted, () => resolve());
        });
    }

    private sendMessage(message: Message): Promise<void> {
        return new Promise((resolve, _reject) => {
            const encrypted: string = this._cipher.encryptObject(message);
            return this._socket.emit("say", message.recipientId, encrypted, () => resolve());
        });
    }

    private onMessageReceived(callback: (message: Message) => void): void {
        this._socket.on("msg", (id: string, _name: string, encryptedMessage: string) => {
            try {
                if (id !== this._myAgentId) {
                    const message: Message = this._cipher.decryptObject(encryptedMessage);
                    callback(message);
                }
            } catch (ex) {}
        });
    }
}
