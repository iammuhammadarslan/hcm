import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ResolutionAction {
  LOCAL_UPDATED_TO_HCM = 'LOCAL_UPDATED_TO_HCM',
  WARNING_LOGGED = 'WARNING_LOGGED',
}

export enum DetectedDuring {
  REALTIME_SYNC = 'REALTIME_SYNC',
  BATCH_SYNC = 'BATCH_SYNC',
  POST_WRITE_READ = 'POST_WRITE_READ',
  CONFLICT_RESOLUTION = 'CONFLICT_RESOLUTION',
}

@Entity('balance_discrepancies')
export class BalanceDiscrepancy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  localValue: number;

  @Column('decimal', { precision: 10, scale: 2 })
  hcmValue: number;

  @Column({ type: 'varchar' })
  resolutionAction: ResolutionAction;

  @Column({ type: 'varchar' })
  detectedDuring: DetectedDuring;

  @Index()
  @CreateDateColumn()
  detectedAt: Date;
}
