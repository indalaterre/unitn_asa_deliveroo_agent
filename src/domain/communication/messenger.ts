import type { Agent, Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import type { HandoffRequest, HandoffStatus, HandoffResponse } from "@domain/models/handoff-coordinator";

/**
 * Message types for agent communication
 */
export enum MessageType {
    HELLO = "hello", // Basic greeting/presence notification
    PARCEL_INFO = "parcel_info", // Share information about parcels
    AGENT_UPDATE = "agent_update", // Update information about other agents
    HANDOFF_REQUEST = "handoff_request", // Request to hand off parcels to another agent
    HANDOFF_RESPONSE = "handoff_response", // Response to a handoff request
    HANDOFF_CONFIRM = "handoff_confirm", // Confirmation that a handoff has occurred
    EXPLORATION_SECTOR_ASSIGNMENT = "exploration_sector_assignment",
}

/**
 * Base interface for all message types
 */
export interface Message {
    type: MessageType;
    timestamp: number;
    senderId: string;
    recipientIds: string[];
}

/**
 * Hello message to announce presence
 */
export interface HelloMessage extends Message {
    type: MessageType.HELLO;
    position: Position;
    score: number;
    instantiationTime: number;
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

export interface ExplorationSectorAssignment extends Message {
    type: MessageType.EXPLORATION_SECTOR_ASSIGNMENT;
    positions: Position[];
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
 * Handoff request message for parcel transfers
 * TODO: Should we maybe send the parcels total score to give more decision power to the partner agent?
 */
export interface HandoffRequestMessage extends Message {
    type: MessageType.HANDOFF_REQUEST;
    requestId: string; // Unique ID for this handoff request
    parcelIds: string[]; // IDs of parcels to hand off
    meetingPosition: Position; // Proposed meeting location
    urgency: number; // Priority of this handoff (1-10)
    timeToMeet: number; // Timestamp for when to meet
    expiresAt: number; // When this request expires
    status: HandoffStatus;
    estimatedArrivalTime?: number;
}

/**
 * Handoff confirmation message
 */
export interface HandoffResponseMessage extends Message {
    type: MessageType.HANDOFF_RESPONSE;
    status: HandoffStatus;  // 
    requestId: string; // ID of the original request
    estimatedArrivalTime: number; // When the agent expected to arrive
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
    replyHelloMessage(message: HelloMessage): Promise<void[]>;

    /**
     * Register a callback for receiving hello messages
     * @param callback Function to call when a hello message is received
     */
    onHelloMessageReceived(callback: (agent: Agent) => void): void;

    /**
     * Share information about parcels with other agents
     * @param message Contains the array of parcels to share information about
     */
    sendParcelInfo(message: ParcelInfoMessage): Promise<any>;

    /**
     * Register a callback for receiving parcel info messages
     * @param callback Function to call when a parcel info message is received
     */
    onParcelInfoReceived(callback: (parcels: Parcel[]) => void): void;

    /**
     * Share information about parcels with other agents
     * @param message Contains the array of parcels to share information about
     */
    sendAgentsInfo(message: AgentPositionUpdate): Promise<any>;

    /**
     * Register a callback for receiving parcel info messages
     * @param callback Function to call when a parcel info message is received
     */
    onAgentsInfoReceived(callback: (agents: Agent[]) => void): void;

    /**
     * Sends (from master agent) the assigned exploration sector with the set of positions to explore
     * @param message
     */
    sendExplorationAssignment(message: ExplorationSectorAssignment): Promise<void[]>;

    /**
     * Registers a callback for receiving exploration assignments
     * @param callback
     */
    onExplorationAssignmentReceived(callback: (assignment: Position[]) => void): void;

    /**
     * Send a handoff request to another agent
     * @param request {@link HandoffRequest} Handoff request
     * @returns Request ID that can be used to track responses
     */
    sendHandoffRequest(request: HandoffRequest): Promise<void[]>;

    /**
     * Register a callback for receiving handoff requests
     * @param callback  the callback function
     */
    onHandoffRequestReceived(callback: (request: HandoffRequest) => void): void;

    /**
     * 
     * @param handoffMessage 
     */
    sendHandoffResponseMessage(handoffMessage: HandoffResponse): Promise<void[]>;

    /**
     * 
     * @param callback 
     */
    onHandoffResponseReceived(callback: (response: HandoffResponse) => void): void;
}
