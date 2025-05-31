import { expect } from 'chai';
import sinon from 'sinon';

import {
  Weekday,
  Months,
  getNextWeekDay,
  getNDaysFromNow,
  getNDaysFromDate,
  getRemnDaysInWeek,
  getRemnDaysInMonth,
  getRemnDaysInYear,
  diffBtwnDatesInDays,
  getMidPointBetweenDates,
  DateRegexes,
  parseDueDate,
  getMonthNumFromAbbrev,
  getWeekDayNumFromAbbrev,
  conventionalToMilitaryTime,
} from './date.utils';

import * as loggerModule from './logger';
sinon.stub(loggerModule, 'logger').value({ info: sinon.stub() });

describe('date.utils', function () {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('Enums', () => {
    describe('Weekday', () => {
      it('should have correct weekday values', () => {
        expect(Weekday.Sunday).to.equal(0);
        expect(Weekday.Monday).to.equal(1);
        expect(Weekday.Tuesday).to.equal(2);
        expect(Weekday.Wednesday).to.equal(3);
        expect(Weekday.Thursday).to.equal(4);
        expect(Weekday.Friday).to.equal(5);
        expect(Weekday.Saturday).to.equal(6);
      });
    });

    describe('Months', () => {
      it('should have correct month values', () => {
        expect(Months.Jan).to.equal(0);
        expect(Months.Feb).to.equal(1);
        expect(Months.Mar).to.equal(2);
        expect(Months.Apr).to.equal(3);
        expect(Months.May).to.equal(4);
        expect(Months.Jun).to.equal(5);
        expect(Months.Jul).to.equal(6);
        expect(Months.Aug).to.equal(7);
        expect(Months.Sep).to.equal(8);
        expect(Months.Oct).to.equal(9);
        expect(Months.Nov).to.equal(10);
        expect(Months.Dec).to.equal(11);
      });
    });
  });

  describe('getNextWeekDay', () => {
    it('should return next Sunday when today is Monday', () => {
      clock.setSystemTime(new Date('2025-01-06'));
      const result = getNextWeekDay(Weekday.Sunday);
      expect(result.getDay()).to.equal(0);
      expect(result.getDate()).to.equal(5);
    });

    it('should return next Friday when today is Wednesday', () => {
      clock.setSystemTime(new Date('2025-01-08'));
      const result = getNextWeekDay(Weekday.Friday);
      expect(result.getDay()).to.equal(5);
      expect(result.getDate()).to.equal(10);
    });

    it('should return same day if target is today', () => {
      clock.setSystemTime(new Date('2025-01-10'));
      const result = getNextWeekDay(Weekday.Friday);
      expect(result.getDay()).to.equal(5);
      expect(result.getDate()).to.equal(10);
    });
  });

  describe('getNDaysFromNow', () => {
    it('should return correct date 5 days from now', () => {
      clock.setSystemTime(new Date('2025-01-01'));
      const result = getNDaysFromNow(5);
      expect(result.getDate()).to.equal(6);
    });
  });

  describe('getNDaysFromDate', () => {
    it('should return correct date N days from input date', () => {
      const result = getNDaysFromDate(new Date('2025-01-01'), 10);
      expect(result.getDate()).to.equal(11);
    });
  });

  describe('getRemnDaysInWeek', () => {
    it('should return remaining days in the week from Wednesday', () => {
      clock.setSystemTime(new Date('2025-01-08'));
      const result = getRemnDaysInWeek();
      expect(result).to.equal(4);
    });
  });

  describe('getRemnDaysInMonth', () => {
    it('should return remaining days in the month from Jan 10', () => {
      clock.setSystemTime(new Date('2025-01-10'));
      const result = getRemnDaysInMonth();
      expect(result).to.equal(21);
    });
  });

  describe('getRemnDaysInYear', () => {
    it('should return remaining days in the year from Jan 1', () => {
      clock.setSystemTime(new Date('2025-01-01'));
      const result = getRemnDaysInYear();
      expect(result).to.equal(364);
    });
  });

  describe('diffBtwnDatesInDays', () => {
    it('should return correct difference in days between two dates', () => {
      const result = diffBtwnDatesInDays(
        new Date('2025-01-01'),
        new Date('2025-01-11')
      );
      expect(result).to.equal(10);
    });
  });

  describe('getMidPointBetweenDates', () => {
    it('should return midpoint date', () => {
      const result = getMidPointBetweenDates(
        new Date('2025-01-01'),
        new Date('2025-01-11')
      );
      expect(result.getDate()).to.equal(6);
    });
  });

  describe('parseDueDate', () => {
    it('should parse YYYY-MM-DD', () => {
      const result = parseDueDate('2025-06-01');
      expect(result.getFullYear()).to.equal(2025);
      expect(result.getMonth()).to.equal(5);
      expect(result.getDate()).to.equal(1);
    });
  });

  describe('getMonthNumFromAbbrev', () => {
    it('should return correct month number', () => {
      expect(getMonthNumFromAbbrev('Jan')).to.equal(0);
      expect(getMonthNumFromAbbrev('Dec')).to.equal(11);
    });
  });

  describe('getWeekDayNumFromAbbrev', () => {
    it('should return correct weekday number', () => {
      expect(getWeekDayNumFromAbbrev('Mon')).to.equal(1);
      expect(getWeekDayNumFromAbbrev('Sun')).to.equal(0);
    });
  });

  describe('conventionalToMilitaryTime', () => {
    it('should convert AM/PM to 24-hour format', () => {
      expect(conventionalToMilitaryTime('2:30 PM')).to.equal('14:30');
      expect(conventionalToMilitaryTime('2:30 AM')).to.equal('02:30');
    });
  });

  describe('DateRegexes', () => {
    it('should match YYYY-MM-DD', () => {
      expect('2025-06-01').to.match(DateRegexes.YYYYMMDD);
    });

    it('should match MM/DD/YYYY', () => {
      expect('06/01/2025').to.match(DateRegexes.MMDDYYYY);
    });
  });
});
