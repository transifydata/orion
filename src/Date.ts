import moment, {Moment} from "moment-timezone";
import assert from "assert";

export class TimeTz {
    private time: Moment;
    private tz: string;

    constructor(time: number, tz: string) {
        this.tz = tz;
        this.time = moment.unix(time / 1000).tz(tz);

        // Check that we are passing in milliseconds, not seconds since epoch
        assert(this.time.year() >= 2000 && this.time.year() < 2100);
    }

    offsetSecs(x: number): TimeTz {
        return new TimeTz((this.time.unix() + x) * 1000,this.tz);
    }

    secondsOfDay() {
        // timezone is from IANA timezone database, like "America/Toronto"
        return this.time.diff(this.time.clone().startOf("day"), "seconds");
    }

    dayOfWeek(): string {
        return this.time.format('dddd').toLowerCase();
    }

    dayAsYYYYMMDD() {
        return this.time.format("YYYYMMDD");
    }
}

export function secondsToHHMMSS(secondsOfDay: number): string {
    const hours = Math.floor(secondsOfDay / 3600);
    const minutes = Math.floor(secondsOfDay / 60) % 60;
    const seconds2 = secondsOfDay % 60;

    const formattedHours = hours.toString().padStart(2, "0");
    const formattedMinutes = minutes.toString().padStart(2, "0");
    const formattedSeconds = seconds2.toString().padStart(2, "0");

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}
