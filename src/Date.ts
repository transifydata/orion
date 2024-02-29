import moment, {Moment} from "moment-timezone";
import assert from "assert";

export class TimeTz {
    private time: Moment;
    private tz: string;

    toString() {
        return this.time.toString();
    }
    constructor(time: number, tz: string) {
        this.tz = tz;
        this.time = moment.unix(time / 1000).tz(tz);

        // Check that we are passing in milliseconds, not seconds since epoch
        assert(this.time.year() >= 2000 && this.time.year() < 2100, `Year invalid: ${this.time.toString()} ${time} ${tz}`);
    }

    unixSecs() {
        return this.time.unix();
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

    const formattedHours = Math.max(hours, 0).toString().padStart(2, "0");
    const formattedMinutes = Math.max(minutes, 0).toString().padStart(2, "0");
    const formattedSeconds = Math.max(seconds2, 0).toString().padStart(2, "0");

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}