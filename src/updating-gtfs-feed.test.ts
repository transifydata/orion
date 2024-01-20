import { UpdatingGtfsFeed } from "./updating-gtfs-feed";
import {
  testArrivalDepartureFits,
  testScheduledVehiclesLocation,
} from "./get-scheduled-vehicle-locations";

async function test_date(datestring: string) {
  const date = new Date(datestring);
  const feed = await UpdatingGtfsFeed.openWait("brampton", date.getTime());
  const shape = feed.getShapesAsGeoJSON({ shape_id: 10198 });
  console.log(shape);
  // const statement = feed.db.prepare("SELECT * FROM feed_info;");
  // const result = statement.all();
  // console.log(result);
}

async function test() {
  await test_date("2023/11/11");
  // await test_date("2023/11/12");
  // await test_date("2023/9/13");
}

async function test2() {
  console.log("Running test2()");
  // await testScheduledVehiclesLocation();
  await testArrivalDepartureFits();
}

test2();
