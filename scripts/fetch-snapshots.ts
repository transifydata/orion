import axios from "axios"

// Function to call the endpoint for each day period
async function callEndpointForDays() {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-02-29');
    const endpoint = 'https://orion.transify.ca/snapshot';
    const authHeader = process.env.AUTH_SNAPSHOT;

    for (let currentDate = startDate; currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
        const startTime = Math.floor(currentDate.getTime() / 1000);
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const endTime = Math.floor(nextDate.getTime() / 1000);

        const url = `${endpoint}?startTime=${startTime}&endTime=${endTime}`;
        const headers = {
            Authorization: authHeader
        };

        try {
            const response = await axios.get(url, { headers });
            console.log(`Data received for ${new Date(startTime * 1000)} to ${new Date(endTime * 1000)}:`, response.data);
            // Process the response as needed
        } catch (error) {
            console.error(`Error fetching data for ${new Date(startTime * 1000)} to ${new Date(endTime * 1000)}:`, error.message);
        }
    }
}

// Call the function
callEndpointForDays();
