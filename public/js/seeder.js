seeder = {
	// number of mouse movements to wait for
	seedLimit: (function () {
		var num = Crypto.util.randomBytes(12)[11];
		return 200 + Math.floor(num);
	})(),

	seedCount: 0, // counter
	lastInputTime: new Date().getTime(),
	seedPoints: [],

	// seed function exists to wait for mouse movement to add more entropy before generating an address
	seed: function (evt) {
		if (!evt) var evt = window.event;
		var timeStamp = new Date().getTime();
		// seeding is over now we generate and display the address
		if (seeder.seedCount == seeder.seedLimit) {
			seeder.seedCount++;
			seeder.removePoints();
      $('body').trigger('seeded')
		}
		// seed mouse position X and Y when mouse movements are greater than 40ms apart.
		else if ((seeder.seedCount < seeder.seedLimit) && evt && (timeStamp - seeder.lastInputTime) > 10) {
			SecureRandom.seedTime();
			SecureRandom.seedInt16((evt.clientX * evt.clientY));
			seeder.seedCount++;
			seeder.lastInputTime = new Date().getTime();
		}
	},

	removePoints: function () {
		for (var i = 0; i < seeder.seedPoints.length; i++) {
			document.body.removeChild(seeder.seedPoints[i]);
		}
		seeder.seedPoints = [];
	}
};
