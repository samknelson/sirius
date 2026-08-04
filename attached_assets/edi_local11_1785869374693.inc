<?php

class Sirius_Smf_Report_Edi_Local11 extends Report_Cache_Report_Generator {
  public $type = 'sirius-smf-edi-local11';

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Local 11'),
      'description' => '',
      'access' => 'sirius trust staff',
      'preview' => array(
        'default_display_fields' => array(
          'worker_ssn',
          'worker_name',
          'employer_name',
          'employer_code',
          'hours_year',
          'hours_month',
          'hours_amt',
          'hours_type',
        ),
        'preview_links' => TRUE,
      ),
      'module' => 'sirius_smf',
      'file' => 'reports/edi_local11.inc',
      'row_encoding' => 'json',
      'edi_output_format' => 'csv',
    );

    return parent::info($result);
  }

  public function fields() {
    $fields = array();
    $fields['worker_ssn'] = 'Worker SSN';
    $fields['worker_name'] = 'Worker Name';
    $fields['worker_nid'] = 'Worker NID';
    $fields['employer_name'] = 'Employer Name';
    $fields['employer_code'] = 'Employer Code';
    $fields['payperiod_nid'] = 'Payperiod NID';
    $fields['hours_year'] = 'Year';
    $fields['hours_month'] = 'Month';
    $fields['hours_amt'] = 'Hours';
    $fields['hours_type'] = 'Hours Type';
    return $fields;
  }

  public function preview_links($row) {
    $links = array();
    $links['node/' . $row['worker_nid'] . '/sirius_worker_hours'] = 'Worker';
    $links['node/' . $row['payperiod_nid'] . '/sirius_payperiod_simple'] = 'Payperiod';
    return $links;
  }

  public function form() {
    $form['start_year'] = array(
      '#type' => 'textfield',
      '#title' => t('Start Year'),
      '#size' => 4,
      '#default_value' => date('Y', strtotime('-10 months')),
    );

    $form['start_month'] = array(
      '#title' => t('Start Month'),
      '#type' => 'textfield',
      '#size' => 2,
      '#default_value' => date('m', strtotime('-10 months')),
    );

    $form['end_year'] = array(
      '#type' => 'textfield',
      '#title' => t('End Year'),
      '#size' => 4,
      '#default_value' => date('Y', strtotime('-1 month')),
    );

    $form['end_month'] = array(
      '#title' => t('End Month'),
      '#type' => 'textfield',
      '#size' => 2,
      '#default_value' => date('m', strtotime('-1 month')),
    );

    return $form;
  }

  public function pks(&$form_state) {
    $sql_args = array();

    $sql = "select distinct worker_nid ";
    $sql .= "from sirius_hours_cache ";
    $sql .= "left join node on node.nid = sirius_hours_cache.worker_nid ";
    $sql .= "left join field_data_field_sirius_domain on field_data_field_sirius_domain.entity_type = 'node' and field_data_field_sirius_domain.entity_id = node.nid ";

    $sql .= "where field_sirius_domain_target_id = :domain_nid ";
    $sql_args[':domain_nid'] = sirius_domain_nid();

    // $sql .= "and worker_nid >= 13249985 ";

    $sql .= "and year >= :start_year ";
    $sql_args[':start_year'] = $form_state['values']['parameters']['start_year'];
    $sql .= "and year <= :end_year ";
    $sql_args[':end_year'] = $form_state['values']['parameters']['end_year'];

    $sql .= "order by worker_nid ";
    $stmt = sirius_sql_query($sql, $sql_args);

    $pks = array();
    while ($hr = $stmt->fetchAssoc()) {
      $pks[] = $hr['worker_nid'];
    }
    return array_chunk($pks, 100);
  }

  public function batch($worker_nids, $values, &$context) {
    $start_year = $values['parameters']['start_year'];
    $start_month = $values['parameters']['start_month'];
    $start_ym = date('Y-m', strtotime("$start_year-$start_month-01"));

    $end_year = $values['parameters']['end_year'];
    $end_month = $values['parameters']['end_month'];
    $end_ym = date('Y-m', strtotime("$end_year-$end_month-01"));

    $rows = array();
    foreach ($worker_nids as $worker_nid) {
      $sql = "select title, field_sirius_ssn_value ";
      $sql .= "from node ";
      $sql .= "left join field_data_field_sirius_ssn on field_data_field_sirius_ssn.entity_type = 'node' and field_data_field_sirius_ssn.entity_id = node.nid ";
      $sql .= "where nid = :worker_nid ";
      $stmt = sirius_sql_query($sql, array(':worker_nid' => $worker_nid));
      $hr = $stmt->fetchAssoc();
      if (!$hr) { continue; }
      $worker_ssn = $hr['field_sirius_ssn_value'];
      $worker_name = $hr['title'];

      $sql_args = array();
      $sql = "select * from sirius_hours_cache ";
      $sql .= "where worker_nid = :worker_nid ";
      $sql_args[':worker_nid'] = $worker_nid;
      $sql .= "order by year, month, day ";
      $stmt = sirius_sql_query($sql, $sql_args);
      while ($hr = $stmt->fetchAssoc()) {
        $year = $hr['year'];
        $month = $hr['month'];
        $ym = date('Y-m', strtotime("$year-$month-01"));
        if ($ym < $start_ym || $ym > $end_ym) { continue; }

        $employer_node = node_load($hr['employer_nid']);
        if (!$employer_node) { continue; }

        $row = array();
        $row['worker_ssn'] = $worker_ssn;
        $row['worker_name'] = $worker_name;

        $row['hours_year'] = $year;
        $row['hours_month'] = $month;
        $row['hours_amt'] = $hr['hours'];

        $row['employer_name'] = $employer_node->title;
        $row['employer_code'] = $employer_node->field_sirius_id['und'][0]['value'];

        $row['worker_nid'] = $hr['worker_nid'];
        $row['payperiod_nid'] = $hr['payperiod_nid'];
        $row['employer_nid'] = $hr['employer_nid'];
        $row['hours_type'] = sirius_term_title($hr['hours_type_tid']);

        // Why didn't I put an ID on the hours table?!?!
        $pk = join('|', array(
          $row['worker_ssn'],
          $row['hours_year'],
          $row['hours_month'],
          $row['employer_name'],
          md5(print_r($hr, 1)),
        ));

        $rows[$pk] = $row;
      }
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }
}
