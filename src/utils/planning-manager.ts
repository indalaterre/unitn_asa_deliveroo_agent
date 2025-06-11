import { Duration, GameConfiguration } from "@domain/models";
import axios from "axios";

export type Agent = {
    name: string;
    location: string;
    capacity?: number; // Maximum number of packages an agent can carry
};

export type PddlParcel = {
    name: string;
    location: string;
    score: number;
};

export type PddlLocation = {
    position: string;
    isDelivery: boolean;
};

export interface WorldState {
    myAgent: Agent;
    agents: Agent[];
    packages: PddlParcel[];
    locations: PddlLocation[];
}

export class PlanningManager {
    /**
     * The planner to be invoked
     * @private
     */
    private readonly PLANNER_NAME: string = "enhsp";

    /**
     * The number of executions. Used to calculate the AVG planning time
     * @private
     */
    private planningExecutionDurations: Duration[] = [];

    /**
     * A semaphore to avoid concurrent Planner invocations
     * @private
     */
    private planningSemaphore = false;

    /**
     * @returns The average execution time
     */
    get avgExecutionDuration(): Duration {
        const avgExecutionInSeconds: number = this.planningExecutionDurations
            .map((duration: Duration) => duration.seconds)
            .reduce((acc, curr) => acc + curr, 0);

        return Duration.fromSeconds(avgExecutionInSeconds);
    }

    /**
     * Run the Fast Downward planner on the given domain and problem files
     * @param worldState  the world state
     * @returns The planner output as a string
     */
    async runPlanner(worldState: WorldState): Promise<{ action: string; parameters: string[] }[]> {
        if (this.planningSemaphore) {
            return [];
        }

        this.planningSemaphore = true;

        const domainContent: string = this.generateDomainPDDL();
        const problemContent: string = this.generateProblemPDDL(worldState);

        try {
            // Prepare the payload for the HTTP request - match the expected format in planner-server.py
            const payload = {
                domain: domainContent,
                problem: problemContent,
            };

            // Make the HTTP request to the planning service
            const response = await axios.post(
                `http://localhost:6790/package/${this.PLANNER_NAME}/solve`,
                payload,
            );

            let result: string | string[];
            // Process the response from the planner server
            if (response.data.plan) {
                // Successfully found a plan
                this.planningSemaphore = false;
                result = this.parsePlannerOutput(response.data.plan);
            } else if (response.data.stdout) {
                // Check if the planner found the problem unsolvable
                if (
                    response.data.stdout.includes("No relaxed solution") ||
                    response.data.stdout.includes("Completely explored state space -- no solution")
                ) {
                    console.warn(
                        "Fast Downward found the problem unsolvable. Check your PDDL domain and problem definitions.",
                    );
                    // Return a special marker for unsolvable problems
                    result = "UNSOLVABLE";
                }

                // Return stdout if no plan was found, but we have output
                console.log("Fast Downward returned output but no plan.");
                result = response.data.stdout;
            } else {
                console.log("Fast Downward returned no output.");
                result = "";
            }

            this.planningSemaphore = false;
            return this.parsePlanArray(result);
        } catch (error) {
            this.planningSemaphore = false;
            // Handle HTTP request errors
            console.error("Error calling Fast Downward planning service:", error.message);

            // Check if we got a response with error data
            if (error.response && error.response.data) {
                console.error("Planning service error:", error.response.data);
                if (error.response.data.stdout) {
                    console.log("Planner stdout:", error.response.data.stdout);

                    // Check if the problem is unsolvable
                    if (
                        error.response.data.stdout.includes("No relaxed solution") ||
                        error.response.data.stdout.includes(
                            "Completely explored state space -- no solution",
                        )
                    ) {
                        return [];
                    }
                }
                if (error.response.data.stderr) {
                    console.error("Planner stderr:", error.response.data.stderr);
                }
            }

            // Re-throw the error with a more descriptive message
            throw new Error(`Failed to call Fast Downward planning service: ${error.message}`);
        }
    }

    /**
     * Parse a JSON array of plan steps from Fast Downward
     * @param planArray Array of plan steps in string format
     * @returns Parsed plan with structured steps
     */
    private parsePlanArray(
        planArray: string | string[] | { time: number; action: string }[],
    ): { action: string; parameters: string[] }[] {
        try {
            let steps = null;
            if (typeof planArray === "string") {
                if (!planArray?.trim() || planArray === "UNSOLVABLE") {
                    console.log("No plan found or problem unsolvable");
                    return [];
                } else {
                    steps = JSON.parse(planArray);
                }
            } else {
                steps = planArray as (string | { time: number; action: string })[];
            }

            // Process each step
            return steps?.map((step: string | { time: number; action: string }) => {
                // Remove outer parentheses and split by spaces
                const rawStep = typeof step === "string" ? step : step.action;
                const cleanStep = rawStep
                    .trim()
                    .replace(/^\(|\)$/g, "") // Remove outer parentheses
                    .trim();

                const parts: string[] = cleanStep
                    .split(/\s+/)
                    .map((token) => token.replace(/^x_/, ""));
                const action = parts[0];
                const parameters = parts.slice(1);

                return {
                    action,
                    parameters,
                };
            });
        } catch (e) {
            console.error("Error parsing plan array:", e);
            return [];
        }
    }

    private parsePlannerOutput(output: string): string | string[] {
        const plan = [];
        const lines = output.split("\n");

        for (const line of lines) {
            const match = line.match(/^\s*(\d+(\.\d+)?):\s+\(([^)]+)\)/);
            if (match) {
                plan.push({
                    time: Number.parseFloat(match[1]),
                    action: match[3],
                });
            }
        }

        this.planningExecutionDurations = [
            ...this.planningExecutionDurations,
            Duration.fromMilliseconds(PlanningManager.extractPlanningTime(output)),
        ];

        return plan;
    }

    private generateDomainPDDL(): string {
        return `
(define (domain delivery)
  (:requirements :strips :typing :action-costs)
  (:types agent package location)

  (:predicates
    (at ?a - agent ?l - location)
    (at-pkg ?p - package ?l - location)
    (is-delivery ?l - location)
    (carrying ?a - agent ?p - package)
    (available ?p - package)
    (different ?from ?to - location)
    (has-delivered ?a - agent)
  )
  
  (:functions
    (score ?p - package)
    (distance ?from ?to - location)
   
    ;; Metric functions
    (total-cost) ;; Total move cost. Must be minimized (The cost will contain the parcels decaying information)
    (carrying-packages)
  )

  (:action move
    :parameters (?a - agent ?from - location ?to - location)
    :precondition (and 
      (at ?a ?from) 
      (different ?from ?to)
    )
    :effect (and
      (not (at ?a ?from))
      (at ?a ?to)
      (increase (total-cost) (distance ?from ?to)) ;; Basic cost for movement
    )
  )

  (:action pick-up
    :parameters (?a - agent ?p - package ?l - location)
    :precondition (and 
      (at ?a ?l) 
      (at-pkg ?p ?l) 
      (available ?p) 
    )
    :effect (and
      (carrying ?a ?p)
      (not (at-pkg ?p ?l))
      (increase (carrying-packages) 1)
    )
  )

  (:action deliver
    :parameters (?a - agent ?p - package ?l - location)
    :precondition (and 
      (at ?a ?l) 
      (carrying ?a ?p)
      (is-delivery ?l)
    )
    :effect (and
      (not (carrying ?a ?p))
      (has-delivered ?a)
      (decrease (carrying-packages) 1)
      (decrease (total-cost) (score ?p)) ;; Basic cost for movement
    )
  )
)
`;
    }

    private generateProblemPDDL(state: WorldState): string {
        // Generate object declarations with sanitized names
        const agentObjs = PlanningManager.sanitizeName(state.myAgent.name);
        const packageObjs = state.packages
            .map((p) => PlanningManager.sanitizeName(p.name))
            .join(" ");

        const locationsWithoutDuplicates = new Set(state.locations);
        const locationObjs: string = Array.from(locationsWithoutDuplicates)
            .map((l: PddlLocation) => PlanningManager.sanitizeName(l.position))
            .join(" ");

        // Generate initial state predicates
        const atAgents = `(at ${agentObjs} ${PlanningManager.sanitizeName(state.myAgent.location)})`;
        const atPkgs = state.packages
            .map(
                (p) =>
                    `(at-pkg ${PlanningManager.sanitizeName(p.name)} ${PlanningManager.sanitizeName(p.location)})`,
            )
            .join("\n    ");
        // Initialize available state.packages
        const availablePackages = state.packages
            .map((p) => `(available ${PlanningManager.sanitizeName(p.name)})`)
            .join("\n    ");

        const deliveryLocation: PddlLocation[] = state.locations.filter(
            (location: PddlLocation) => location.isDelivery,
        );
        if (!deliveryLocation?.length) {
            throw new Error("Planning must have a delivery location");
        }

        const isDeliveryPredicated = `(is-delivery ${PlanningManager.sanitizeName(deliveryLocation[0].position)})`;

        const moveScoreCost = GameConfiguration.moveScoreCost;
        const differences: Set<string> = new Set<string>();
        const distanceValues: any[] = [];
        // Calculate Manhattan distance (assuming locations are in format 'x,y')
        for (let i = 0; i < state.locations.length; i++) {
            for (let j = 0; j < state.locations.length; j++) {
                if (i !== j) {
                    let distance = 1; // Default distance
                    const locationA: string = state.locations[i]?.position;
                    const locationB: string = state.locations[j]?.position;

                    if (locationA === locationB) {
                        continue;
                    }

                    const locationASanitized: string = PlanningManager.sanitizeName(locationA);
                    const locationBSanitized: string = PlanningManager.sanitizeName(locationB);

                    const [x1, y1] = locationA.split("_").map(Number);
                    const [x2, y2] = locationB.split("_").map(Number);
                    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
                        //We use a weighted distance to include the move duration and the decaying factor
                        distance = (Math.abs(x1 - x2) + Math.abs(y1 - y2)) * moveScoreCost;
                    }

                    distanceValues.push({
                        locationKey: `${locationASanitized} ${locationBSanitized}`,
                        distance,
                    });
                    differences.add(`(different ${locationASanitized} ${locationBSanitized})`);
                }
            }
        }

        //We need to normalize all the scores by shifting for the minimum abs value to avoid negatives and fractional
        const metricWeights = {
            scale: 10,
            scores: 1,
            distances: 7,
        };

        const scores: Set<string> = new Set<string>();
        for (const parcel of state.packages) {
            const fixedScore: number = Math.round(parcel.score * metricWeights.scores);
            scores.add(`(= (score ${PlanningManager.sanitizeName(parcel.name)}) ${-fixedScore})`);
        }

        const distancesPredicates: Set<string> = new Set<string>();
        for (const distanceValue of distanceValues) {
            const fixedDistance: number = Math.round(
                distanceValue.distance * metricWeights.distances,
            );
            distancesPredicates.add(`(= (distance ${distanceValue.locationKey}) ${fixedDistance})`);
        }

        const differencesPredicates: string = Array.from(differences).join("\n    ");
        const scoresPredicates: string = Array.from(scores).join("\n    ");

        // Collect all initialization predicates
        const initPredicates: string[] = [
            atAgents,
            atPkgs,
            availablePackages,
            isDeliveryPredicated,
            Array.from(distancesPredicates).join("\n    "),
            differencesPredicates,
            scoresPredicates,
        ];

        // Initialize total-cost to 0
        const hasNotDelivered = `(not (has-delivered ${agentObjs}))`;
        const totalCost = "(= (total-cost) 0)";
        const carryingPackages = "(= (carrying-packages) 0)";

        // Join all predicates and functions, filtering out any that might still be empty
        const initPredicatesAndFunctions = [
            ...initPredicates,
            totalCost,
            carryingPackages,
            hasNotDelivered,
        ]
            .filter((predicate: string) => predicate?.trim())
            .join("\n    ");

        // Fast Downward requires the metric to be exactly (:metric minimize (total-cost))

        return `
(define (problem delivery-problem)
  (:domain delivery)
  (:objects
    ${agentObjs} - agent
    ${packageObjs} - package
    ${locationObjs} - location
  )
  (:init
    ${initPredicatesAndFunctions}
  )
  (:goal (and
    (has-delivered ${agentObjs})
    (= (carrying-packages) 0))
  )
  ;; FastDownward does not support maximization problems. We need to invert all the scores
  (:metric minimize (total-cost)))
)
`;
    }

    private static sanitizeName(name: string): string {
        //We need to add a prefix because to avoid confusion between planners requires names to start by letters
        //This is required only by Metric-FF. We don't use it but better than nothing
        return "x_" + name.replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    /**
     * Extract the planning time for statistics
     * @param report    the output of PDDL
     * @private
     */
    private static extractPlanningTime(report: string): number | null {
        const match = report.match(/Planning Time \(msec\):\s*(\d+)/);
        return match ? Number.parseInt(match[1], 10) : null;
    }
}
