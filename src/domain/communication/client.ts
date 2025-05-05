import { type Socket, io } from "socket.io-client";

import type { Actuator } from "@domain/communication/actuator";
import { Directions, Position, Tile } from "@domain/models/environment";

import * as console from "node:console";
import type { Information } from "@domain/communication/information";
import type { Sensor } from "@domain/communication/sensor";
import { Duration, type EnvironmentConfiguration, Parcel } from "@domain/models";
import { Agent } from "@domain/models/agent";
import { DecayingValue } from "@domain/models/decaying-value";
import { IdAware } from "@domain/models/id-aware";
import { PlayerInfo } from "@domain/player-info";

export class SocketClient implements Actuator, Information, Sensor {
    private readonly _socket: Socket;

    constructor(deliverooHost: string, token: string) {
        this._socket = io(deliverooHost, {
            autoConnect: true,
            extraHeaders: { "x-token": token },
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
                return;
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
                        tile.parcelSpawner ?? tile.type === 1,
                        tile.delivery ?? tile.type === 2,
                        tile.type !== 0,
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
            if (!parcelsToPutDown?.length) {
                console.log("No parcels to put down. Action will be ignored");
            }

            this._socket.emit("putdown", parcelsToPutDown, (response: any[]) => {
                const putDownParcels: Set<string> = new Set<string>();
                for (const parcel of response) {
                    putDownParcels.add(parcel.id);
                }

                resolve(putDownParcels);
            });
        });
    }
}
