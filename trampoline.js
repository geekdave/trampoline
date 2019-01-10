// trampoline.js
// (C) 2018 Dave Cadwallader
// Released under the MIT license
//
// Derived from code from pigpio, also released under the MIT license
// See: https://github.com/fivdi/pigpio#measure-distance-with-a-hc-sr04-ultrasonic-sensor

const Gpio = require('pigpio').Gpio;

var trampolineHeight;
var measurements = [];
var downThreshold = 5;
var upThreshold = 1;

const Influx = require('influx');
const influx = new Influx.InfluxDB({
    host: 'weatherman.local',
    database: 'distance',
    schema: [
        {
            measurement: 'proximity',
            fields: {
                distance_cm: Influx.FieldType.FLOAT
            },
            tags: [
                'location'
            ]
        }, {
            measurement: 'jumps',
            fields: {
                distance_cm: Influx.FieldType.FLOAT
            },
            tags: [
                'location'
            ]
        },
    ]
})

// The number of microseconds it takes sound to travel 1cm at 20 degrees celcius
const MICROSECONDS_PER_CM = 1e6 / 34321;

const trigger = new Gpio(23, { mode: Gpio.OUTPUT });
const echo = new Gpio(24, { mode: Gpio.INPUT, alert: true });

trigger.digitalWrite(0); // Make sure trigger is low

var waitingForDownward = true;
var previousTime;

const watchHCSR04 = () => {
    let startTick;

    echo.on('alert', (level, tick) => {
        if (level == 1) {
            startTick = tick;
        } else {
            const endTick = tick;
            const diff = (endTick >> 0) - (startTick >> 0); // Unsigned 32 bit arithmetic
            const distanceCM = diff / 2 / MICROSECONDS_PER_CM

            if (distanceCM > 100) {
                console.log("What a silly number: " + distanceCM)
            } else {

                influx.writePoints([
                    {
                        measurement: 'proximity',
                        fields: { distance_cm: distanceCM },
                    }
                ]);
                // console.log(distanceCM);

                if (measurements.length < 3) {
                    measurements.push(distanceCM);

                    if (measurements.length == 3) {
                        trampolineHeight = ( measurements[0] + measurements[1] + measurements[2] ) / 3;
                        console.log("Trampoline height: " + trampolineHeight);
                    }
                }

                if (!previousTime) {
                    previousTime = new Date();
                }

                const now = new Date();

                if (now - previousTime >= 100) {
                    if (waitingForDownward && distanceCM < (trampolineHeight - downThreshold)) {
                        waitingForDownward = false;
                        previousTime = now;
                        console.log(">>> Valley at " + distanceCM);
                        influx.writePoints([
                            {
                                measurement: 'jumps',
                                fields: { distance_cm: distanceCM },
                                tags: { location: "valley" },
                            }
                        ]);

                    } else if (!waitingForDownward && distanceCM > (trampolineHeight - upThreshold)) {
                        waitingForDownward = true;
                        previousTime = now;
                        console.log("<<< Peak at " + distanceCM);
                        influx.writePoints([
                            {
                                measurement: 'jumps',
                                fields: { distance_cm: distanceCM },
                                tags: { location: "peak" },
                            }
                        ]);
                    }
                }
            }
        }
    });
};

watchHCSR04();

// Trigger a distance measurement once per second
setInterval(() => {
    trigger.trigger(10, 1); // Set trigger high for 10 microseconds
}, 50);