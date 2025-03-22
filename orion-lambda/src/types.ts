export interface Agency {
    id: string;
    provider: string;
    gtfs_realtime_url?: string;
    tripUpdatesUrl?: string;
    nextbus_agency_id?: string;
}

export interface LambdaEvent { 
    // Our lambda takes no inputs currently
}

export interface LambdaResponse {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
} 