import * as path from "path";
import commandLineArgs, { type CommandLineOptions } from "command-line-args";
import * as dotenv from "dotenv";

import type { Actuator } from "@domain/communication";
import { SocketClient } from "@domain/communication/client";
import type { Messenger } from "@domain/communication/messenger";
import type { Sensor } from "@domain/communication/sensor";
import { MatchMap } from "@domain/map";
import {
    type AgentConfiguration,
    type CryptoConfiguration,
    GameConfiguration,
} from "@domain/models";
import { PlayerBDI } from "@domain/player-bdi";

function getConfiguration(): AgentConfiguration {
    const options = [
        { name: "host", type: String },
        { name: "token", type: String },
        { name: "use-pddl", type: String },
        { name: "agent-name", type: String },
        { name: "public-key", type: String },
        { name: "private-key", type: String },
        { name: "planner-host", type: String },
        { name: "hello-interval", type: Number },
        { name: "max-last-heard", type: Number },
        { name: "max-carrying-parcels", type: Number },
        { name: "agents-density-radius", type: Number },
    ];

    const defaultValues = new Map<string, string | number | boolean>();
    defaultValues.set("use-pddl", false);
    defaultValues.set("agent-name", "main");
    defaultValues.set("hello-interval", 2000);
    defaultValues.set("max-last-heard", 6000);
    defaultValues.set("max-carrying-parcels", 6);
    defaultValues.set("agents-density-radius", 4);
    defaultValues.set("planner-host", "http://localhost:6790");

    // first check if the corresponding environment variables are set
    const config = new Map<string, string | number | boolean>();

    // then parse the command line arguments
    const cliArgs: CommandLineOptions = commandLineArgs(options);
    for (const arg in cliArgs) {
        config.set(arg, cliArgs[arg]);
    }

    dotenv.config({ path: ".env" });

    const agentName: string = (config.get("agent-name") as string) ?? "main";
    // --- Construct env file path ---
    const envPath: string = path.resolve(__dirname, "..", `.player.env.${agentName}`);

    // --- Load env file ---
    dotenv.config({ path: envPath });

    for (const option of options) {
        const varName: string = option.name.toUpperCase().replace(/-/g, "_");
        const envValue: string = process.env[varName];

        if (envValue !== undefined) {
            config.set(option.name, option.type(envValue));
        } else if (defaultValues.has(option.name)) {
            config.set(option.name, defaultValues.get(option.name)!);
        } else {
            throw new Error(`Missing option ${option.name}`);
        }
    }

    //We cannot shorten this statement due to a typescript -> javascript compile error
    const defaultPddlOption = config.get("use-pddl") || "";

    return {
        host: config.get("host") as string,
        token: config.get("token") as string,
        usePddl: defaultPddlOption == "true",
        plannerHost: config.get("planner-host") as string,

        cryptoKeyPaths: {
            publicPath: config.get("public-key") as string,
            privatePath: config.get("private-key") as string,
        } as CryptoConfiguration,

        maxCarryingParcels: config.get("max-carrying-parcels") as number,
        agentsDensityRadius: config.get("agents-density-radius") as number,
    } as AgentConfiguration;
}

async function main(): Promise<void> {
    const gameConfiguration: AgentConfiguration = getConfiguration();
    console.log("Starting agent with BDI architecture");
    console.log(JSON.stringify(gameConfiguration, null, 2));

    const client = new SocketClient(
        gameConfiguration.host,
        gameConfiguration.token,
        gameConfiguration.cryptoKeyPaths,
    );

    const [playerInfo, freeTiles, envConfig] = await Promise.all([
        client.getPlayerInfo(),
        client.getFreeTiles(),
        client.loadConfiguration(),
    ]);

    GameConfiguration.init(gameConfiguration, envConfig);

    const mathMap: MatchMap = await MatchMap.build(freeTiles, playerInfo.position);

    // Create a player using the BDI architecture
    const player = new PlayerBDI(
        mathMap,
        client as Sensor,
        client as Actuator,
        client as Messenger,
        playerInfo,
    );

    console.log(
        `Player ID is: ${playerInfo.id}, Name: ${playerInfo.name}; Initial position: ${playerInfo.position}`,
    );

    await player.start();
}

main()
    // eslint-disable-next-line no-console
    .then(() => console.log("Session terminated"))
    // eslint-disable-next-line no-console
    .catch((err) => console.error(err));
