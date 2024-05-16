
// /**
//  * Represents a TimeBuilder class for scheduling tasks based on time settings.
//  *
//  * @class
//  */
// class TimeBuilder {

//   /**
//    * Creates an instance of TimeBuilder.
//    *
//    * @constructor
//    * @param {Object} [options={}] - The options for the TimeBuilder.
//    * @param {Function} options.func - The function to be executed when the time conditions are met.
//    * @throws {Error} Throws an error if options.func is not a function.
//    */
//   constructor(options = {}) {
//     this.options = options;
//     this.TimeSetting = [];

//     // Validate that options.func is a function
//     if (typeof this.options.func !== "function") {
//       throw new Error("func must be a function");
//     }
//   }

//   /**
//    * Sets the time settings for scheduling tasks.
//    *
//    * @param {Object} TimeSetting - The time settings for a specific task.
//    * @param {number} [TimeSetting.timeStart=Date.now()] - The start time for the task (in milliseconds).
//    * @param {number} TimeSetting.timCompleted - The duration of the task (in milliseconds).
//    * @throws {Error} Throws an error if timeStart or timCompleted are not numbers.
//    */
//   setTimeSetting(TimeSetting = {}) {

//     TimeSetting.timeStart = TimeSetting.timeStart || Date.now();
//     // Validate that timeStart is a number
//     if (typeof TimeSetting?.timeStart !== "number") {
//       throw new Error("timeStart must be a number");
//     }

//     // Validate that timCompleted is a number
//     if (typeof TimeSetting.timCompleted !== "number") {
//       throw new Error("timCompleted must be a number");
//     }

//     // Add the TimeSetting to the array
//     this.TimeSetting = (TimeSetting);
//   }

//   /**
//    * Starts the TimeBuilder, executing the provided function when the time conditions are met.
//    */
//   start() {
//     const currentTime = Date.now();
//     let timeoutID

//     // Iterate through each TimeSetting
//     // this.TimeSetting.forEach(async Setting => {
//     if (this.TimeSetting) {
//       let Setting = this.TimeSetting
//       const endTime = Setting.timeStart + Setting.timCompleted;
//       // Check if the current time is before the end time
//       if (endTime > currentTime) {
//         const timeDiff = endTime - currentTime;
//         // Schedule the function to be executed after the time difference
//         timeoutID = setTimeout(() => {
//           this.options.func();
//         }, timeDiff);
//       }
//     }
//     // });

//     return timeoutID
//   }
// }

// // Export the TimeBuilder class
// module.exports = { TimeBuilder };
const schedule = require('node-schedule');


/**
 * Represents a TimeBuilder class for scheduling tasks based on time settings.
 * @class
 */
class TimeBuilder {
  /**
   * Creates an instance of TimeBuilder.
   *
   * @constructor
   * @param {Object} [options={}] - The options for the TimeBuilder.
   * @param {Function} options.func - The function to be executed when the time conditions are met.
   * @throws {Error} Throws an error if options.func is not a function.
   */
  constructor(options = {}) {
    this.options = options;
    this.TimeSetting = [];

    if (typeof this.options.func !== "function") {
      throw new Error("func must be a function");
    }
  }

  /**
   * Sets the time settings for scheduling tasks.
   *
   * @param {Object} TimeSetting - The time settings for a specific task.
   * @param {number} [TimeSetting.timeStart=Date.now()] - The start time for the task (in milliseconds).
   * @param {number} TimeSetting.timCompleted - The duration of the task (in milliseconds).
   * @throws {Error} Throws an error if timeStart or timCompleted are not numbers.
   */
  setTimeSetting(TimeSetting = {}) {
    TimeSetting.timeStart = TimeSetting.timeStart || Date.now();

    if (typeof TimeSetting?.timeStart !== "number") {
      throw new Error("timeStart must be a number");
    }

    if (typeof TimeSetting.timCompleted !== "number") {
      throw new Error("timCompleted must be a number");
    }

    this.TimeSetting = (TimeSetting);
  };

  /**
   * @returns  job time schedule
   */
  start() {
    const currentTime = Date.now();
    let job;

    if (this.TimeSetting) {
      let Setting = this.TimeSetting;
      const endTime = Setting.timeStart + Setting.timCompleted;

      if (endTime > currentTime) {
        const timeDiff = new Date(endTime).toISOString();
        // Schedule the function to be executed using node-schedule
        job = schedule.scheduleJob(timeDiff, () => {
          this.options.func();
        });
      };
    };
    return job;
  };
};

module.exports = { TimeBuilder };
