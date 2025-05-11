import type { Agent, Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import type { IntentionTypes } from "@domain/models/intention";

/**
 * Message types for agent communication
 */
export enum MessageType {
    HELLO = "hello", // Basic greeting/presence notification
    INTENTION = "intention", // Share current intention
    PARCEL_INFO = "parcel_info", // Share information about parcels
    HELP_REQUEST = "help_request", // Request assistance from other agents
    HELP_RESPONSE = "help_response", // Response to a help request
    COORDINATION = "coordination", // Coordinate actions between agents
    AGENT_UPDATE = "agent_update", // Update information about other agents
    HANDOFF_REQUEST = "handoff_request", // Request to hand off parcels to another agent
    HANDOFF_RESPONSE = "handoff_response", // Response to a handoff request
    HANDOFF_CONFIRM = "handoff_confirm", // Confirmation that a handoff has occurred
}

/**
 * Base interface for all message types
 */
export interface Message {
    type: MessageType;
    timestamp: number;
    senderId: string;
    recipientId: string;
}

/**
 * Hello message to announce presence
 */
export interface HelloMessage extends Message {
    type: MessageType.HELLO;
    position: Position;
    score: number;
}

/**
 * Intention message to share what the agent is doing
 */
export interface IntentionMessage extends Message {
    type: MessageType.INTENTION;
    intentionType: IntentionTypes;
    targetPosition: Position;
    currentPosition: Position;
    priority?: number;
}

/**
 * Parcel information message
 */
export interface AgentPositionUpdate extends Message {
    type: MessageType.AGENT_UPDATE;
    agents: {
        agentId: string;
        position: Position;
        score: number;
    }[];
}

/**
 * Parcel information message
 */
export interface ParcelInfoMessage extends Message {
    type: MessageType.PARCEL_INFO;
    parcels: {
        id: string;
        agentId: string;
        position: Position;
        score: number;
    }[];
}

/**
 * Help request message
 */
export interface HelpRequestMessage extends Message {
    type: MessageType.HELP_REQUEST;
    requestId: string; // Unique ID for this request
    requestType: "pickup" | "delivery";
    position: Position;
    parcelIds?: string[];
    urgency: number; // 1-10 scale, 10 being most urgent
    expiresAt: number; // Timestamp when this request expires
}

/**
 * Help response message
 */
export interface HelpResponseMessage extends Message {
    type: MessageType.HELP_RESPONSE;
    requestId: string;
    accepted: boolean;
    estimatedTimeToArrive?: number; // in milliseconds
}

/**
 * Coordination message for joint actions
 */
export interface CoordinationMessage extends Message {
    type: MessageType.COORDINATION;
    action: "split_parcels" | "clear_area" | "joint_delivery" | "territory_claim";
    position: Position;
    details: any; // Flexible structure for different coordination types
}

/**
 * Handoff request message for parcel transfers
 */
export interface HandoffRequestMessage extends Message {
    type: MessageType.HANDOFF_REQUEST;
    requestId: string; // Unique ID for this handoff request
    parcelIds: string[]; // IDs of parcels to hand off
    meetingPosition: Position; // Proposed meeting location
    urgency: number; // Priority of this handoff (1-10)
    timeToMeet: number; // Timestamp for when to meet
    expiresAt: number; // When this request expires
}

/**
 * Handoff response message
 */
export interface HandoffResponseMessage extends Message {
    type: MessageType.HANDOFF_RESPONSE;
    requestId: string; // ID of the request being responded to
    accepted: boolean; // Whether the handoff is accepted
    parcelIds: string[]; // Confirmed parcel IDs to be handed off
    meetingPosition: Position; // Confirmed meeting location
    estimatedArrivalTime: number; // When the agent expects to arrive
}

/**
 * Handoff confirmation message
 */
export interface HandoffConfirmMessage extends Message {
    type: MessageType.HANDOFF_CONFIRM;
    requestId: string; // ID of the original request
    parcelIds: string[]; // IDs of parcels that were handed off
    success: boolean; // Whether the handoff was successful
    position: Position; // Where the handoff occurred
}

/**
 * Defines the messaging methods to communicate with other agents
 * "Shout" methods: sends messages in broadcast
 * "Send" methods: sends messages to a specific agent
 */
export interface Messenger {
    /**
     * Broadcast a hello message to announce presence
     * @param message Hello message to broadcast
     */
    shoutHelloMessage(message: HelloMessage): Promise<void>;

    /**
     * Replies to a hello message sending its own position
     * @param message
     */
    replyHelloMessage(message: HelloMessage): Promise<void>;

    /**
     * Register a callback for receiving hello messages
     * @param callback Function to call when a hello message is received
     */
    onHelloMessageReceived(callback: (agent: Agent) => void): void;

    /**
     * Share information about parcels with other agents
     * @param message Contains the array of parcels to share information about
     */
    shoutParcelInfo(message: ParcelInfoMessage): Promise<void>;

    /**
     * Register a callback for receiving parcel info messages
     * @param callback Function to call when a parcel info message is received
     */
    onParcelInfoReceived(callback: (parcels: Parcel[]) => void): void;

    /**
     * Share information about parcels with other agents
     * @param message Contains the array of parcels to share information about
     */
    shoutAgentsInfo(message: AgentPositionUpdate): Promise<void>;

    /**
     * Register a callback for receiving parcel info messages
     * @param callback Function to call when a parcel info message is received
     */
    onAgentsInfoReceived(callback: (agents: Agent[]) => void): void;

    /**
     * Broadcast current intention to other agents
     * @param intentionType Type of intention from IntentionTypes enum
     * @param targetPosition Target position of the intention
     * @param currentPosition Current position of the agent
     * @param priority Optional priority of this intention
     */
    shoutIntention(
        intentionType: IntentionTypes,
        targetPosition: Position,
        currentPosition: Position,
        priority?: number,
    ): Promise<void>;

    /**
     * Request help from nearby agents
     * @param requestType Type of help needed ("pickup" or "delivery")
     * @param position Position where help is needed
     * @param parcelIds Optional IDs of parcels involved
     * @param urgency Urgency level (1-10)
     * @param expiresIn Time in milliseconds until this request expires
     * @returns Request ID that can be used to track responses
     */
    shoutHelpRequest(
        requestType: "pickup" | "delivery",
        position: Position,
        parcelIds?: string[],
        urgency?: number,
        expiresIn?: number,
    ): Promise<string>;

    /**
     * Respond to a help request
     * @param targetAgentId ID of the agent that sent the request
     * @param requestId ID of the request being responded to
     * @param accepted Whether the help request is accepted
     * @param estimatedTimeToArrive Optional estimated time to arrive (in milliseconds)
     */
    sendHelpResponse(
        targetAgentId: string,
        requestId: string,
        accepted: boolean,
        estimatedTimeToArrive?: number,
    ): Promise<void>;

    /**
     * Send a coordination message to organize joint actions
     * @param action Type of coordination action
     * @param position Position related to the coordination
     * @param details Additional details about the coordination
     * @param targetAgentId Optional specific agent to send to (if not provided, broadcasts to all)
     */
    sendCoordinationMessage(
        action: string,
        position: Position,
        details?: any,
        targetAgentId?: string,
    ): Promise<void>;

    /**
     * Send a handoff request to another agent
     * @param targetAgentId ID of the agent to request handoff from
     * @param parcelIds IDs of parcels to hand off
     * @param meetingPosition Proposed meeting location
     * @param urgency Priority of this handoff (1-10)
     * @param timeToMeet When to meet (timestamp)
     * @param expiresIn Time in milliseconds until this request expires
     * @returns Request ID that can be used to track responses
     */
    sendHandoffRequest(
        targetAgentId: string,
        parcelIds: string[],
        meetingPosition: Position,
        urgency: number,
        timeToMeet: number,
        expiresIn?: number,
    ): Promise<string>;

    /**
     * Respond to a handoff request
     * @param targetAgentId ID of the agent that sent the request
     * @param requestId ID of the request being responded to
     * @param accepted Whether the handoff is accepted
     * @param parcelIds Confirmed parcel IDs to be handed off
     * @param meetingPosition Confirmed meeting location
     * @param estimatedArrivalTime When the agent expects to arrive
     */
    sendHandoffResponse(
        targetAgentId: string,
        requestId: string,
        accepted: boolean,
        parcelIds: string[],
        meetingPosition: Position,
        estimatedArrivalTime: number,
    ): Promise<void>;

    /**
     * Confirm a handoff has occurred
     * @param targetAgentId ID of the agent involved in the handoff
     * @param requestId ID of the original request
     * @param parcelIds IDs of parcels that were handed off
     * @param success Whether the handoff was successful
     * @param position Where the handoff occurred
     */
    sendHandoffConfirm(
        targetAgentId: string,
        requestId: string,
        parcelIds: string[],
        success: boolean,
        position: Position,
    ): Promise<void>;
}
