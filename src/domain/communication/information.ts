import type { EnvironmentConfiguration } from "@domain/models";
import type { Tile } from "@domain/models/environment";
import type { PlayerInfo } from "@domain/player-info";

/**
 * Defines the method to get information about the match
 */
export interface Information {
    /**
     * @returns the initial information of the player
     */
    getPlayerInfo(): Promise<PlayerInfo>;

    /**
     * @returns the set of tiles that the agent can walk on
     */
    getFreeTiles(): Promise<Tile[]>;

    /**
     * Gets the current configuration of the match
     */
    getEnvironment(): Promise<EnvironmentConfiguration>;
}
