export function logEventWithAgency(event: string, agency: string, args: Record<string, any> = {}) {
    const jsonPayload = {
        "event": event,
        "agency": agency,
        ...args,
    }
    console.log(JSON.stringify(jsonPayload));
} 