import axios, {AxiosResponse} from "axios";

// Function to call the endpoint for each day period
async function callEndpointForDays() {
    const startDate = new Date('2024-01-02');
    const endDate = new Date('2024-01-14');
    const endpoint = 'https://orion.transify.ca/snapshot';
    // const endpoint = 'http://localhost:4000/snapshot'
    const authHeader = process.env.AUTH_SNAPSHOT;

    const maxConcurrentRequests = 5;
    const requestsQueue = [];
    const responses: AxiosResponse[] = [];

    for (let currentDate = startDate; currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
        const startTime = currentDate.getTime();
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const endTime = nextDate.getTime();

        const url = `${endpoint}?startTime=${startTime}&endTime=${endTime}`;
        const headers = {
            Authorization: authHeader
        };

        const requestPromise = axios.get(url, { headers })
            .then(response => {
                responses.push(response);
            })
            .catch(error => {
                console.error(`Error fetching data for ${new Date(startTime)} to ${new Date(endTime)}:`, error.message, error);
            });

        requestsQueue.push(requestPromise);

        // If the number of requests in the queue reaches the maximum allowed, wait for them to finish
        if (requestsQueue.length >= maxConcurrentRequests) {
            await Promise.all(requestsQueue);
            requestsQueue.length = 0; // Clear the requests queue
        }
    }

    // Wait for any remaining requests to finish
    await Promise.all(requestsQueue);

    responses.forEach((response, index) => {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + index);
        const startTime = currentDate.getTime();
        const endTime = new Date(currentDate.getTime());
        endTime.setDate(endTime.getDate() + 1);
        console.log(`Data received for ${new Date(startTime)} to ${endTime}:`, response.data);
        // Process the response as needed
    });
}

// Call the function
callEndpointForDays();
