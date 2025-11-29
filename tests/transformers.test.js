import { ConflictTransformer } from '../scripts/utils/conflict-transformer.js';

describe('ConflictTransformer', () => {
    let transformer;

    beforeEach(() => {
        transformer = new ConflictTransformer();
    });

    it('should transform a standard conflict record', () => {
        const input = [{
            date: '2023-10-07',
            location: 'Gaza',
            fatalities: 100,
            injuries: 200,
            event_type: 'airstrike'
        }];

        const output = transformer.transform(input, { source: 'Test Source' });

        expect(output).toHaveLength(1);
        const record = output[0];

        expect(record).toHaveProperty('date', '2023-10-07');
        expect(record.location).toHaveProperty('name', 'Gaza'); // Location is an object
        expect(record).toHaveProperty('category', 'conflict');
        expect(record).toHaveProperty('fatalities', 100);
        expect(record).toHaveProperty('injuries', 200);
    });

    it('should handle missing fields gracefully', () => {
        const input = [{
            date: '2023-10-07'
        }];

        const output = transformer.transform(input, { source: 'Test Source' });

        expect(output).toHaveLength(1);
        const record = output[0];

        expect(record).toHaveProperty('date', '2023-10-07');
        expect(record).toHaveProperty('fatalities', 0);
    });
});
