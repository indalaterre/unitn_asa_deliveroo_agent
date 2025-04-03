import commandLineArgs from "command-line-args";
import * as dotenv from "dotenv";

import type { Actuator } from "@domain/communication";
import { SocketClient } from "@domain/communication/client";
import type { Sensor } from "@domain/communication/sensor";
import { MatchMap } from "@domain/map";
import {
    type AgentConfiguration,
    type CryptoConfiguration,
    GameConfiguration,
} from "@domain/models/configurations";
import { Player } from "@domain/player";

function getConfiguration(): AgentConfiguration {
    dotenv.config();

    const options = [
        { name: "host", type: String },
        { name: "token", type: String },
        { name: "public-key", type: String },
        { name: "private-key", type: String },
        { name: "hello-interval", type: Number },
        { name: "max-last-heard", type: Number },
        { name: "start-iterations", type: Number },
        { name: "num-promising-positions", type: Number },
        { name: "gaussian-std", type: Number },
        { name: "discount-factor", type: Number },
        { name: "use-pddl", type: Boolean },
    ];

    const defaultValues = new Map<string, number | boolean>();
    defaultValues.set("hello-interval", 2000);
    defaultValues.set("max-last-heard", 6000);
    defaultValues.set("start-iterations", 10);
    defaultValues.set("num-promising-positions", 5);
    defaultValues.set("gaussian-std", 1.0);
    defaultValues.set("discount-factor", 0.0);
    defaultValues.set("use-pddl", false);

    // first check if the corresponding environment variables are set
    const config = new Map<string, string | number | boolean>();
    for (const option of options) {
        const varName = option.name.toUpperCase().replace(/-/g, "_");
        if (process.env[varName]) {
            config.set(option.name, option.type(process.env[varName]));
        }
    }

    // then parse the command line arguments
    const cliArgs = commandLineArgs(options);
    for (const arg in cliArgs) {
        config.set(arg, cliArgs[arg]);
    }

    // check that all options are set
    for (const option of options) {
        if (!config.get(option.name)) {
            if (defaultValues.has(option.name)) {
                config.set(option.name, defaultValues.get(option.name)!);
            } else {
                throw new Error(`Missing option ${option.name}`);
            }
        }
    }

    return {
        host: config.get("host") as string,
        token: config.get("token") as string,
        cryptoKeyPaths: {
            publicPath: config.get("public-key") as string,
            privatePath: config.get("private-key") as string,
        } as CryptoConfiguration,
    } as AgentConfiguration;
}

async function main(): Promise<void> {
    const gameConfiguration: AgentConfiguration = getConfiguration();
    console.log("Starting agent with config");
    console.log(JSON.stringify(gameConfiguration, null, 2));

    const client = new SocketClient(gameConfiguration.host, gameConfiguration.token);

    const [playerInfo, freeTiles, envConfig, initialParcels] = await Promise.all([
        client.getPlayerInfo(),
        client.getFreeTiles(),
        client.loadConfiguration(),
        client.detectParcels(),
    ]);

    GameConfiguration.init(envConfig);

    const mathMap: MatchMap = await MatchMap.build(freeTiles, playerInfo.position);

    const player = new Player(
        mathMap,
        initialParcels,
        gameConfiguration.cryptoKeyPaths,

        client as Sensor,
        client as Actuator,
        playerInfo,
        null,
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
