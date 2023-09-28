import mqtt from "mqtt";
import config from "$config";

export default mqtt.connect("mqtt://ln.coinos.io", config.mqtt);
