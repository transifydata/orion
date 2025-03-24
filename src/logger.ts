// Used for log-based metrics--if we log a JSON string, GKE logging agent parses it into a structured log
function logEventWithAgency(event: string, agency: string, args: Record<string, any> = {}) {
    const jsonPayload = {
        "event": event,
        "agency": agency,
        ...args,
    }
    console.log(JSON.stringify(jsonPayload));
}

export { logEventWithAgency };