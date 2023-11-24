import mqtt from "mqtt";
import config from "$config";

export let mqtt1 = mqtt.connect("mqtt://ln.coinos.io", config.mqtt1);
export let mqtt2 = mqtt.connect("mqtt://mqtt.coinos.io", config.mqtt2);
