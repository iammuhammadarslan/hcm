import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

export enum UpdateSource {
  EMPLOYEE_REQUEST = 'EMPLOYEE_REQUEST',
  HCM_REALTIME = 'HCM_REALTIME',
  HCM_BATCH = 'HCM_BATCH',
  HCM_CONFLICT_RESOLUTION = 'HCM_CONFLICT_RESOLUTION',
}

@Entity('balances')
@Unique(['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  value: number;

  @Column({ type: 'varchar', default: UpdateSource.EMPLOYEE_REQUEST })
  lastUpdateSource: UpdateSource;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
