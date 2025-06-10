import { type Socket, io } from "socket.io-client";

import type { Actuator } from "@domain/communication/actuator";
import { Directions, Position, Tile, TileType } from "@domain/models/environment";

import { Cipher } from "@domain/communication/cipher";
import type { Information } from "@domain/communication/information";
import { MessageFactory } from "@domain/communication/message-factory";
import type { Sensor } from "@domain/communication/sensor";
import { Duration, type EnvironmentConfiguration, Parcel } from "@domain/models";
import { Agent } from "@domain/models/agent";
import type { CryptoConfiguration } from "@domain/models/configurations";
import { DecayingValue } from "@domain/models/decaying-value";
import type { HandoffRequest, HandoffResponse, HandoffUpdate } from "@domain/models/handoff-coordinator";
import { IdAware } from "@domain/models/id-aware";
import { PlayerInfo } from "@domain/player-info";
import { MessageType } from "./messenger";
import type {
    AgentPositionUpdate,
    ExplorationSectorAssignment,
    HandoffResponseMessage,
    HandoffRequestMessage,
    HandoffUpdateMessage,
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

    sendHandoffRequest(request: HandoffRequest): Promise<void[]> {
        const message: HandoffRequestMessage = MessageFactory.createHandoffRequestMessage(
            request.requestId,
            request.initiatorId,
            request.receiverId,
            request.parcelIds,
            request.meetingPosition,
            request.urgency,
            request.timeToMeet,
            request.expiresAt,
            request.status,
            request.actionRequired,
            request.estimatedArrivalTime,
        );

        return this.sendMessage(message);
    }

    onHandoffRequestReceived(callback: (request: HandoffRequest) => void): void {
        this.onMessageReceived((message: HandoffRequestMessage) => {

            if (message.type != MessageType.HANDOFF_REQUEST) {
                return;
            }

            const parsedRequest: HandoffRequest = {
                requestId: message.requestId,
                initiatorId: message.senderId,
                receiverId: message.recipientIds[0],
                parcelIds: message.parcelIds,
                meetingPosition: new Position(message.meetingPosition.row, message.meetingPosition.column),
                urgency: message.urgency,
                timeToMeet: message.timeToMeet,
                expiresAt: message.expiresAt,
                status: message.status,
                actionRequired: message.actionRequired,
                estimatedArrivalTime: message.estimatedArrivalTime,
            };

            callback(parsedRequest);
        });
    }

    sendHandoffResponseMessage(
        handoffResponse: HandoffResponse
    ): Promise<void[]> {
        const message: HandoffResponseMessage = MessageFactory.createHandoffResponseMessage(
            handoffResponse.requestId,
            handoffResponse.initiatorId,
            handoffResponse.recipientIds,
            handoffResponse.status,
            handoffResponse.meetingPosition,
            handoffResponse.estimatedArrivalTime,
        );

        return this.sendMessage(message);
    }

    /**
     * 
     * @param callback 
     */
    onHandoffResponseReceived(callback: (response: HandoffResponse) => void): void {
        this.onMessageReceived((message: HandoffResponseMessage) => {

            if (message.type != MessageType.HANDOFF_RESPONSE) {
                return
            }

            const parsedResponse: HandoffResponse = {
                requestId: message.requestId,
                initiatorId: message.senderId,
                recipientIds: message.recipientIds,
                status: message.status,
                estimatedArrivalTime: message.estimatedArrivalTime,
            };

            callback(parsedResponse);
        });
    }

    /**
     * 
     * @param handoffUpdate 
     */
    sendHandoffUpdateMessage(handoffUpdate: HandoffUpdate): Promise<void[]> {
        const message: HandoffUpdateMessage = MessageFactory.createHandoffUpdateMessage(
            handoffUpdate.updateId,
            handoffUpdate.handoffId,
            handoffUpdate.initiatorId,
            handoffUpdate.receiverId,
            handoffUpdate.updateType,
            handoffUpdate.meetingPosition,
            handoffUpdate.actionRequired,
            handoffUpdate.estimatedArrivalTime
        );

        return this.sendMessage(message);
    }

     /**
     * 
     * @param callback 
     */
    onHandoffUpdateReceived(callback: (response: HandoffUpdate) => void): void {
        this.onMessageReceived((message: HandoffUpdateMessage) => {

            if (message.type != MessageType.HANDOFF_UPDATE) {
                return;
            }

            console.log(`onHandoffUpdateReceived ${message.updateType}`);

            const parsedResponse: HandoffUpdate = {
                updateId: message.updateId,
                handoffId: message.handoffId,
                initiatorId: message.senderId,
                receiverId: message.recipientIds[0],
                updateType: message.updateType,
                meetingPosition: (message.meetingPosition ? new Position(message.meetingPosition.row, message.meetingPosition.column) : null),
                actionRequired: message.actionRequired,
                estimatedArrivalTime: message.estimatedArrivalTime,
            };

            callback(parsedResponse);
        });
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

    replyHelloMessage(message: HelloMessage): Promise<void[]> {
        return this.sendMessage(message);
    }

    onHelloMessageReceived(callback: (agent: Agent) => void): void {
        this.onMessageReceived((message: HelloMessage) => {

            if (message.type != MessageType.HELLO) {
                return;
            }

            const agentPosition = new Position(message.position.row, message.position.column);
            const agent = new Agent(
                message.senderId,
                agentPosition,
                message.score,
                message.instantiationTime,
            );

            callback(agent);
        });
    }

    sendParcelInfo(message: ParcelInfoMessage): Promise<any> {
        return this.sendMessage(message);
    }

    onParcelInfoReceived(callback: (parcels: Parcel[]) => void): void {
        this.onMessageReceived((message: ParcelInfoMessage) => {

            if (message.type != MessageType.PARCEL_INFO) {
                return;
            }

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

    sendAgentsInfo(message: AgentPositionUpdate): Promise<any> {
        return this.sendMessage(message);
    }

    onAgentsInfoReceived(callback: (agents: Agent[]) => void): void {
        this.onMessageReceived((message: AgentPositionUpdate) => {

            if (message.type != MessageType.AGENT_UPDATE) {
                return;
            }

            const parsedAgents: Agent[] = message.agents.map((agent) => {
                const agentPosition = new Position(agent.position.row, agent.position.column);
                return new Agent(agent.agentId, agentPosition, agent.score);
            });

            callback(parsedAgents);
        });
    }

    sendExplorationAssignment(message: ExplorationSectorAssignment): Promise<void[]> {
        return this.sendMessage(message);
    }

    onExplorationAssignmentReceived(callback: (assignment: Position[]) => void): void {
        this.onMessageReceived((message: ExplorationSectorAssignment) => {

            if (message.type != MessageType.EXPLORATION_SECTOR_ASSIGNMENT) {
                return;
            }

            if (!message?.positions?.length) callback(message.positions);
        });
    }

    private shoutMessage(message: Message): Promise<void> {
        return new Promise((resolve, _reject) => {
            const encrypted: string = this._cipher.encryptObject(message);
            this._socket.emit("shout", encrypted, () => resolve());
        });
    }

    private sendMessage(message: Message): Promise<void[]> {
        const encrypted: string = this._cipher.encryptObject(message);
        const promises: Promise<void>[] = [];

        console.log(`Sending message ${message.type} from ${message.senderId} `);
        for (const recipient of message.recipientIds) {
            promises.push(
                new Promise((resolve, _reject) => {
                    return this._socket.emit("say", recipient, encrypted, () => resolve());
                }),
            );
        }

        return Promise.all(promises);
    }

    private onMessageReceived<T extends Message>(callback: (message: T) => void): void {
        this._socket.on("msg", (id: string, _name: string, encryptedMessage: string) => {
            try {
                if (id !== this._myAgentId) {
                    const message: T = this._cipher.decryptObject(encryptedMessage);
                    callback(message);
                }
            } catch (ex) {
                const a = 1;
            }
        });
    }

    waitForMessageFromAgent<T extends Message>(
        senderId: string,
        expectedType: MessageType,
        timeoutMs: number = 5000
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const handler = (message: T) => {
                if (
                    message.type === expectedType &&
                    message.senderId === senderId
                ) {
                    clearTimeout(timeout);
                    this._socket.off("msg", internalHandler); // rimuove il listener
                    resolve(message);
                }
            };

            const internalHandler = (id: string, _name: string, encryptedMessage: string) => {
                if (id === this._myAgentId) return;

                try {
                    const message: T = this._cipher.decryptObject(encryptedMessage);
                    handler(message);
                } catch (e) {
                    // Ignora messaggi non decifrabili
                }
            };

            this._socket.on("msg", internalHandler);

            const timeout = setTimeout(() => {
                this._socket.off("msg", internalHandler);
                reject(new Error(`Timeout waiting for ${expectedType} from agent ${senderId}`));
            }, timeoutMs);
        });
    }
}
