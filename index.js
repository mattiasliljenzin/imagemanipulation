const parser = require('exif-parser');
const fs = require('fs-extra')
const config = require('./config');
const path = require('path');

const result = {
	total: 0,
	duplicates: 0,
	timeadjusted: 0,
	counters: [],
	history: [],
	timeadjustments: []
};

const timeadjustments = []

Object.keys(config.timeadjustments).forEach(key => {
	let time = new Date().getTime();
	let diff = config.timeadjustments[key].minutes * 60000;

	config.timeadjustments[key].time = (date) => {
		return new Date(date.getTime() + diff);
	};
});

var compare = (obj1, obj2) => {
	return config.comparers.every(comparer => {
		let o1 = obj1[comparer];
		let o2 = obj2[comparer];
		return o1 == o2 && !o1;
	});
}

var isDuplicate = (f) => {
	return result.history.some(file => compare(f, file) === true);
};

var useExtension = (file) => {
	let fileExtension = path.extname(file).toLowerCase();
	return config.extensions.some(e => fileExtension == e);
};

var errorHandler = (err) => {
	console.log('===============================');
	console.log('=== Something bad happened! ===');
	console.log('===============================');
	console.log(err)
};

var readDirectory = () => {
	console.log('readDirectory');
	return new Promise((rs, rj) => {
		fs.readdir(config.src, (err, files) => {
			if (err) rj(err);
			else rs(files);
		});
	});
};

var processFiles = (directoryContents) => {
	console.log('processFiles');
	let files = new Array();

	for (let content of directoryContents) {
		if (useExtension(content)) {
			files.push(config.src + content);
			result.total++;
		}
	}

	return Promise.all(files.map(handleFile));
};

var handleFile = (filepath) => {
	return new Promise((resolve, reject) => {
		fs.readFile(filepath, (err, file) => {
			if (err) {
				console.log('error')
				reject(err);
			} else {

				let meta = parser.create(file).parse().tags;
				let id = config.id;
				let metaId = meta[id];

				if (!meta[id]) {
					meta[id] = config.unknownIdPrefix;
					metaId = config.unknownIdPrefix;
				}

				if (!result.counters[metaId]) {
					result.counters[metaId] = 0;
				}

				let extension = path.extname(filepath);
				let fileId = result.counters[metaId]++;
				let newpath = `${config.dest}${metaId}_${fileId}${extension}`;

				if (config.timeadjustments[metaId]) {
					let func = config.timeadjustments[metaId].time;
					let metaDate = new Date((meta.DateTimeOriginal || meta.CreateDate) * 1000);
					let adjustedDate = func(metaDate);
					meta.DateTimeOriginal = adjustedDate;
					meta.CreateDate = adjustedDate;
					result.timeadjusted++;
					console.log('[%s] adjusted time from %s\t%s', fileId, metaDate, adjustedDate);
				}

				if (isDuplicate(meta) === true) {
					result.duplicates++;
					resolve({
						'duplicated': true
					});
				} else {
					result.history.push(meta);
					resolve({
						'src': filepath,
						'dest': newpath
					});
				}
			}
		})
	});
};

var copyTasks = (tasks) => {
	return Promise.all(tasks.filter(task => task.duplicated !== true).map((task) => {
		return new Promise((resolve, reject) => {
			fs.copy(task.src, task.dest, (err) => {
				if (err) reject(err);
				else {
					//console.log('copied\t %s\t -> \t%s', task.src, task.dest);
					resolve();
				}
			});
		})
	}));
};


var printResults = () => {
	console.log();
	console.log('========= STATUS =========')
	console.log('renamed %s number of files', result.total - result.duplicates);
	Object.keys(result.counters).forEach(c => {
		console.log('renamed %s of type %s', result.counters[c], c);
	});
	console.log('number of duplicates was %s', result.duplicates);
	console.log('number of timeadjusted was %s', result.timeadjusted);
	console.log();
};

readDirectory()
	.then(processFiles)
	.then(copyTasks)
	.then(printResults)
	.catch(errorHandler);