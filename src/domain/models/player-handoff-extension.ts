import type { Messenger } from "../communication/messenger";
import type { Player } from "../player";
import type { CollaborativeBeliefs } from "./collaborative-beliefs";
import { CollaborativeIntentionFactory } from "./collaborative-intention-factory";
import { CollaborativeIntentionTypes } from "./collaborative-intentions";
import { Position } from "./environment";
import { HandoffManager } from "./handoff-manager";
import type { Intention } from "./intention";

/**
 * Extension methods for Player class to support handoff functionality
 * This provides an example of how to integrate handoff capabilities into the Player class
 */
export class PlayerHandoffExtension {
    /**
     * Initializes handoff capabilities in the Player class
     *
     * Call this method from the Player constructor or a similar initialization point
     */
    static initializeHandoffCapabilities(
        player: Player,
        beliefs: CollaborativeBeliefs,
        messenger: Messenger,
    ): void {
        // Create handoff manager
        const handoffManager = new HandoffManager(
            messenger,
            beliefs,
            player["_intentionQueue"], // Accessing protected property
            player["playerInfo"].id.toString(), // Accessing protected property
        );

        // Store the handoff manager in the player instance
        player["_handoffManager"] = handoffManager;

        // Add collaborative beliefs to the player
        player["_collaborativeBeliefs"] = beliefs;

        // Extend checkAndRecalculateIntentions method to evaluate handoff opportunities
        const originalCheckMethod = player["_checkAndRecalculateIntentions"];
        player["_checkAndRecalculateIntentions"] = (
            forceRecalculate = false,
            justPickedUp = false,
        ): void => {
            // Call original method
            originalCheckMethod.call(player, forceRecalculate, justPickedUp);

            // If we're carrying parcels, evaluate handoff opportunities
            if (player["_beliefs"].isCarrying) {
                const currentPosition = player["_beliefs"].myPosition;
                const deliveryPoint = player["_beliefs"].findBestDelivery();

                if (deliveryPoint?.position) {
                    // Get known agents
                    const knownAgents = Array.from(beliefs.getAgentIntentions()).map(
                        (intention) => ({
                            agentId: intention.agentId,
                            position: intention.currentPosition,
                        }),
                    );

                    // Calculate total score of carried parcels
                    const totalScore = player["_beliefs"].carriedParcels.reduce(
                        (sum, parcel) => sum + parcel.score.currentValue,
                        0,
                    );

                    // Evaluate handoff opportunity
                    handoffManager.evaluateHandoffOpportunity(
                        currentPosition,
                        deliveryPoint.position,
                        player["_beliefs"].carryingParcelIds,
                        totalScore,
                        knownAgents,
                    );
                }
            }
        };

        // Extend the _run method to handle collaborative intentions
        const originalRunMethod = player["_run"];
        player["_run"] = async (): Promise<void> => {
            // Execute the original run method
            await originalRunMethod.call(player);

            // Execute handoff-specific logic if needed
            const currentIntention = player["_currentIntention"];
            if (
                currentIntention &&
                CollaborativeIntentionFactory.isHandoffIntention(currentIntention)
            ) {
                await PlayerHandoffExtension.executeHandoffIntention(player, currentIntention);
            }
        };
    }

    /**
     * Executes a handoff intention
     * This would be called from the player's run method
     */
    static async executeHandoffIntention(player: Player, intention: Intention): Promise<void> {
        // Extract information from intention context
        const collaborativeType = intention.context?.collaborativeType;
        const handoffId = intention.context?.requestId;

        // Skip if this is not a handoff intention or missing required context
        if (!collaborativeType || !handoffId) return;

        // Get current position
        const currentPosition = player["_beliefs"].myPosition;

        // Check if we've reached the target position
        if (currentPosition.equals(intention.position)) {
            // We've reached the meeting point, execute the handoff
            const handoffManager = player["_handoffManager"] as HandoffManager;
            if (!handoffManager) return;

            // Determine if we're the initiator
            const isInitiator = collaborativeType === CollaborativeIntentionTypes.INITIATE_HANDOFF;

            // Execute the handoff
            const success = await handoffManager.executeHandoff(handoffId, isInitiator);

            // Clear the intention regardless of outcome
            player["_currentIntention"] = null;

            if (success) {
                // Force recalculation of intentions after handoff
                player["_checkAndRecalculateIntentions"](true);
            }
        }
    }
}
